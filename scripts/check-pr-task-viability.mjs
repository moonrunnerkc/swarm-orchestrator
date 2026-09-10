#!/usr/bin/env node
/**
 * Decides which mined pull requests are usable tasks, by running them rather than by reading them.
 *
 * A mined candidate is only a task if its tests actually specify the feature it added. That is
 * checkable without a person: put the pull request's test file on the unchanged base source and
 * the added cases must fail, because a case that passes before the feature exists is not testing
 * the feature; then take the pull request's source as well and they must pass. A candidate that
 * fails either direction is dropped with the direction named.
 *
 * This is the filter that makes the corpus self-certifying, and it is why no part of building it
 * asks anybody to label anything.
 *
 * The two oracles are halves of that file, so each half is held to the same standard as the file:
 * a half that passes on the base source would accept a patch that changes nothing, and a task
 * dealt that way was never an opportunity to catch anything. A half that passes is re-dealt rather
 * than dropped, since which cases fail on the base is a property of the suite and not of the cut.
 *
 *   node scripts/check-pr-task-viability.mjs [--limit <n>] [--only <owner/repo[#pull]>] [--recheck]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { runProcessGroup } from "../dist/exec/run-process.js";
import { titleFilterFor } from "../dist/eval/oracle-filter.js";
import { prTaskEvidenceRoot, prTaskWorkingRoot } from "../dist/eval/pr-task-paths.js";
import { testCaseDeals } from "../dist/eval/test-case-split.js";
import { parseUnifiedDiff } from "../dist/gates/unified-diff.js";

const repositoryRoot = new URL("..", import.meta.url).pathname;
// Clones live outside the repository: they are two gigabytes of other projects' trees, and kept
// inside it they made this project's own suite walk 1,753 foreign test files on every run.
const workRoot = join(prTaskWorkingRoot(homedir()), "work");
const candidatesPath = join(prTaskEvidenceRoot(repositoryRoot), "candidates.json");
const judgedPath = join(prTaskEvidenceRoot(repositoryRoot), "viable.json");

const argv = process.argv.slice(2);
const limitAt = argv.indexOf("--limit");
const limit = limitAt === -1 ? Number.POSITIVE_INFINITY : Number(argv[limitAt + 1]);
const onlyAt = argv.indexOf("--only");
const only = onlyAt === -1 ? null : argv[onlyAt + 1];
/**
 * Judge a candidate again that has already been judged, replacing its record.
 *
 * A rule change here is worth nothing until it has been run against a candidate whose answer is
 * already known, and without this the only way to do that was to delete the results file: every
 * candidate is judged, so the resumable filter leaves nothing to run. Launching a long mining run
 * to discover whether a rule is right is the expensive failure this project keeps paying for.
 */
const recheck = argv.includes("--recheck");

/**
 * One command, with whatever it started stopped alongside it.
 *
 * `execFile`'s timeout signals the process it started and nothing else, and a mined repository's
 * suite starts servers: two thousand node processes belonging to one repository's tests were
 * still running two days after the campaign that began them, holding deleted checkouts open. The
 * harness already owns the answer, a process group and one signal to it, and a second weaker way
 * of starting a process beside it is how that leak got here.
 */
async function attempt(file, args, options = {}) {
  const ran = await runProcessGroup(file, args, {
    cwd: options.cwd ?? process.cwd(),
    env: definedNames(options.env ?? process.env),
    timeoutMs: options.timeout ?? 10 * 60_000,
    maxOutputBytes: 64 * 1024 * 1024,
  });
  return {
    code: ran.startFailure === null ? ran.exitCode : 127,
    stdout: ran.stdout,
    stderr: ran.startFailure ?? ran.stderr,
    // A command killed at its deadline did not fail, it did not finish. The deal loop needs the
    // difference: a half that hangs is not a half that refuses the base source, and reading it as
    // one admits a task whose oracle can only ever time out.
    timedOut: ran.timedOut,
  };
}

/** An environment as spawn wants it: every name a string, none of them absent. */
function definedNames(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(([, value]) => value !== undefined),
  );
}

/** How this repository runs one test file, read off its devDependencies rather than guessed. */
/**
 * How this repository runs one test file.
 *
 * The project's own `scripts.test` is the authority, and devDependencies are only the fallback.
 * Guessing from devDependencies alone picked `jest` for koa and commander, which both declare
 * `"test": "node --test"` and merely still carry jest in devDependencies: the same repository
 * then got `node --test` at one commit and `npx jest` at another, and the jest runs failed on the
 * merged tree for a reason that had nothing to do with the pull request.
 */
function runnerFor(checkout, testFile) {
  let manifest = {};
  try {
    manifest = JSON.parse(readFileSync(join(checkout, "package.json"), "utf8"));
  } catch {
    return null;
  }
  const declared = `${manifest.scripts?.test ?? ""} ${manifest.scripts?.["test:unit"] ?? ""}`;
  // Read the declared command first, in the order a reader would: the first runner it names.
  const named = [
    [/\bnode\s+--test\b/, ["node", ["--test", testFile]]],
    [/\bvitest\b/, ["npx", ["vitest", "run", testFile]]],
    [/\bjest\b/, ["npx", ["jest", "--ci", testFile]]],
    [/\bmocha\b/, ["npx", ["mocha", testFile]]],
    [/\bava\b/, ["npx", ["ava", testFile]]],
  ];
  let earliest = null;
  for (const [pattern, invocation] of named) {
    const at = declared.search(pattern);
    if (at !== -1 && (earliest === null || at < earliest.at)) earliest = { at, invocation };
  }
  if (earliest !== null) return earliest.invocation;

  const dependencies = { ...manifest.devDependencies, ...manifest.dependencies };
  if (dependencies.jest !== undefined) return ["npx", ["jest", "--ci", testFile]];
  if (dependencies.vitest !== undefined) return ["npx", ["vitest", "run", testFile]];
  if (dependencies.mocha !== undefined) return ["npx", ["mocha", testFile]];
  if (dependencies.ava !== undefined) return ["npx", ["ava", testFile]];
  return ["node", ["--test", testFile]];
}

/**
 * A test script that sets TZ runs its suite under a zone the tests were written for. dayjs runs
 * the same files under four zones in one command. A single file lifted out of that and run under
 * whatever zone this machine is in fails for a reason that is not the pull request, so the zone
 * travels with the invocation.
 */
function environmentFor(checkout) {
  try {
    const manifest = JSON.parse(readFileSync(join(checkout, "package.json"), "utf8"));
    const declared = manifest.scripts?.test ?? "";
    const zone = /\bTZ=([A-Za-z_+\-/0-9]+)/.exec(declared);
    return zone === null ? {} : { TZ: zone[1] };
  } catch {
    return {};
  }
}

/**
 * Written after every judgement rather than at the end of the run. Each candidate costs a clone,
 * an install and two test runs, so a run that dies on its last one would otherwise throw away
 * every judgement before it, and these scripts are only resumable if what they learned survives.
 */
function persist() {
  judged.at = new Date().toISOString();
  writeFileSync(judgedPath, `${JSON.stringify(judged, null, 2)}\n`);
}

/** One record per candidate, whether it is being judged for the first time or judged again. */
function saveJudgement(judgement) {
  const at = judged.tasks.findIndex(
    (one) => one.repository === judgement.repository && one.pull === judgement.pull,
  );
  if (at === -1) judged.tasks.push(judgement);
  else judged.tasks[at] = judgement;
  persist();
}

/**
 * How long one test file gets, on the base source and on the merged tree.
 *
 * A single file that needs longer than this is not a task this corpus can use, and the cost of
 * finding that out is paid on every candidate: koa's respond tests leave a server open and never
 * reach the end of their own standard input, so the run sits until it is killed. Ten minutes was
 * the earlier deadline and it bought nothing, because a file that has not finished in five is
 * waiting rather than working.
 */
const wholeFileDeadlineMs = 5 * 60_000;

const runnerKindOf = (r) =
  r.includes("jest") ? "jest"
  : r.includes("vitest") ? "vitest"
  : r.includes("mocha") ? "mocha"
  : r.includes("ava") ? "ava"
  : "node";

const { candidates } = JSON.parse(readFileSync(candidatesPath, "utf8"));
const judged = existsSync(judgedPath)
  ? JSON.parse(readFileSync(judgedPath, "utf8"))
  : { at: null, tasks: [] };
const alreadyJudged = new Set(judged.tasks.map((one) => `${one.repository}#${one.pull}`));

mkdirSync(workRoot, { recursive: true });
const named = (one) => `${one.repository}#${one.pull}`;
const wanted = candidates.filter(
  (one) =>
    (recheck || !alreadyJudged.has(named(one))) &&
    (only === null || one.repository === only || named(one) === only),
);
console.log(`checking ${Math.min(wanted.length, limit)} candidate(s) by running them\n`);

let checked = 0;
for (const candidate of wanted) {
  if (checked >= limit) break;
  checked += 1;
  const checkout = join(workRoot, candidate.repository.replace("/", "__"));
  const label = `${candidate.repository}#${candidate.pull}`;
  const record = { ...candidate, viable: false, why: "" };

  if (!existsSync(checkout)) {
    const cloned = await attempt("git", ["clone", "--quiet", candidate.cloneUrl, checkout], {
      cwd: workRoot,
      timeout: 10 * 60_000,
    });
    if (cloned.code !== 0) {
      record.why = `clone failed: ${cloned.stderr.slice(0, 160)}`;
      saveJudgement(record);
      console.log(`  DROP  ${label.padEnd(42)} ${record.why}`);
      continue;
    }
  }

  const fetched = await attempt("git", ["fetch", "--quiet", "origin", candidate.mergeCommit], {
    cwd: checkout,
    timeout: 10 * 60_000,
  });
  if (fetched.code !== 0) {
    record.why = "the merge commit is not fetchable (force-pushed or deleted)";
    saveJudgement(record);
    console.log(`  DROP  ${label.padEnd(42)} ${record.why}`);
    continue;
  }

  const parent = await attempt("git", ["rev-parse", `${candidate.mergeCommit}^1`], { cwd: checkout });
  if (parent.code !== 0) {
    record.why = "the merge commit has no first parent to use as a base";
    saveJudgement(record);
    console.log(`  DROP  ${label.padEnd(42)} ${record.why}`);
    continue;
  }
  const base = parent.stdout.trim();
  record.baseCommit = base;

  await attempt("git", ["checkout", "--quiet", "--force", "--detach", base], { cwd: checkout });
  await attempt("git", ["clean", "-qfd"], { cwd: checkout });

  const installed = await attempt("npm", ["ci", "--no-audit", "--no-fund", "--loglevel=error"], {
    cwd: checkout,
    timeout: 15 * 60_000,
  });
  if (installed.code !== 0) {
    record.why = `npm ci failed at the base: ${installed.stderr.slice(-160)}`;
    saveJudgement(record);
    console.log(`  DROP  ${label.padEnd(42)} ${record.why}`);
    continue;
  }

  const runner = runnerFor(checkout, candidate.testFile);
  if (runner === null) {
    record.why = "no package.json to read a runner from";
    saveJudgement(record);
    console.log(`  DROP  ${label.padEnd(42)} ${record.why}`);
    continue;
  }
  record.runner = [runner[0], ...runner[1]].join(" ");

  // The pull request's tests on the unchanged base source. They have to fail: a case that passes
  // before the feature exists is not a specification of the feature.
  await attempt("git", ["checkout", "--quiet", candidate.mergeCommit, "--", candidate.testFile], {
    cwd: checkout,
  });
  const suiteEnvironment = { ...process.env, ...environmentFor(checkout) };
  if (suiteEnvironment.TZ !== undefined) record.timezone = suiteEnvironment.TZ;
  const startedOnBase = Date.now();
  const onBase = await attempt(runner[0], runner[1], {
    cwd: checkout,
    timeout: wholeFileDeadlineMs,
    env: suiteEnvironment,
  });
  const baseRunMs = Date.now() - startedOnBase;
  if (onBase.timedOut) {
    record.why = "the added tests do not finish on the base source, so nothing here was measured";
    saveJudgement(record);
    console.log(`  DROP  ${label.padEnd(42)} ${record.why}`);
    continue;
  }
  if (onBase.code === 0) {
    record.why = "the added tests already pass on the base source, so they specify nothing new";
    saveJudgement(record);
    console.log(`  DROP  ${label.padEnd(42)} ${record.why}`);
    continue;
  }

  // The whole merged tree. They have to pass, or the tests are not a reachable target.
  await attempt("git", ["checkout", "--quiet", "--force", "--detach", candidate.mergeCommit], {
    cwd: checkout,
  });
  const onMerge = await attempt(runner[0], runner[1], {
    cwd: checkout,
    timeout: wholeFileDeadlineMs,
    env: suiteEnvironment,
  });
  if (onMerge.code !== 0) {
    record.why = "the added tests do not pass on the merged tree either, so the target is unclear";
    saveJudgement(record);
    console.log(`  DROP  ${label.padEnd(42)} ${record.why}`);
    continue;
  }

  // Each half against the base, not the file. A half that passes on the base accepts a patch that
  // changes nothing, so the tool's verdict on it establishes nothing and the task is not an
  // opportunity to catch a false green. Checking the whole added file, which is what ran here
  // before, says nothing about either half: 21 of 73 mined tasks turned out unjudgeable underneath
  // a file that qualified, and winston#2181 was published as a false green on one.
  //
  // A half that passes is re-dealt rather than dropped. Which cases fail on the base is a property
  // of the suite and not of the cut, so a different cut can put a failing case on both sides, and
  // dropping the task pays a whole mined candidate for a cut nobody had to keep.
  await attempt("git", ["checkout", "--quiet", "--force", "--detach", base], { cwd: checkout });
  await attempt("git", ["clean", "-qfd"], { cwd: checkout });
  await attempt("git", ["checkout", "--quiet", candidate.mergeCommit, "--", candidate.testFile], {
    cwd: checkout,
  });

  // The cases the pull request added, read from git rather than from the mined record: the record
  // carries one deal already, and a deal is the thing being chosen here.
  const diffed = await attempt(
    "git",
    ["diff", base, candidate.mergeCommit, "--", candidate.testFile],
    { cwd: checkout, timeout: 60_000 },
  );
  const addedCaseSource = parseUnifiedDiff(diffed.stdout)
    .flatMap((file) => file.addedLines.map((line) => line.text))
    .join("\n");
  const kind = runnerKindOf(record.runner);
  // A half cannot honestly need much longer than the whole file did, and one that hangs costs the
  // full deadline on every deal. koa's respond tests leave a server open when only some of them
  // run, so a subset never reaches the end of its own standard input: ten minutes per half, six
  // halves per candidate, for a candidate that was never going to work.
  const halfDeadlineMs = Math.min(wholeFileDeadlineMs, Math.max(60_000, baseRunMs * 3));
  const onBaseUnder = (filter) =>
    attempt(runner[0], [...runner[1].slice(0, -1), ...filter, runner[1].at(-1)], {
      cwd: checkout,
      timeout: halfDeadlineMs,
      env: suiteEnvironment,
    });

  let dealt = null;
  let dealsTried = 0;
  let dealsHung = false;
  let filterIsInexpressible = false;
  for (const deal of testCaseDeals(addedCaseSource)) {
    const sealedTitles = deal.sealed.map((one) => one.title);
    const heldBackTitles = deal.heldBack.map((one) => one.title);
    const sealedFilter = titleFilterFor(kind, sealedTitles);
    const heldBackFilter = titleFilterFor(kind, heldBackTitles);
    // A runner with no spelling for "exactly these titles" cannot deal this file at all, so there
    // is nothing to re-deal: ava's `--match` takes a glob and no alternation, and the widest filter
    // that parses runs the whole suite in both halves, which makes the two oracles one.
    if (sealedFilter === null || heldBackFilter === null) {
      filterIsInexpressible = true;
      break;
    }
    dealsTried += 1;
    const sealedOnBase = await onBaseUnder(sealedFilter);
    if (sealedOnBase.code === 0 || sealedOnBase.timedOut) {
      dealsHung ||= sealedOnBase.timedOut;
      continue;
    }
    const heldBackOnBase = await onBaseUnder(heldBackFilter);
    if (heldBackOnBase.code === 0 || heldBackOnBase.timedOut) {
      dealsHung ||= heldBackOnBase.timedOut;
      continue;
    }
    dealt = { sealedTitles, heldBackTitles };
    break;
  }

  if (dealt === null) {
    record.why = filterIsInexpressible
      ? `${kind} has no filter that names exactly one half's cases, so both oracles would run the whole file`
      : dealsTried === 0
        ? "fewer than two added cases, so there is nothing to deal into two oracles"
        : dealsHung
          ? `none of ${dealsTried} deal(s) both ran to completion and failed on the base source`
          : `none of ${dealsTried} deal(s) leaves both halves failing on the base source`;
    saveJudgement(record);
    console.log(`  DROP  ${label.padEnd(42)} ${record.why}`);
    continue;
  }

  // Overwritten, not merged: the mined record's split is the alternating deal computed from the
  // API's patch, and what the pass must run is the deal proven here.
  record.sealedCases = dealt.sealedTitles;
  record.heldBackCases = dealt.heldBackTitles;
  record.dealsTried = dealsTried;
  record.viable = true;
  record.why =
    "fails on the base source, passes on the merged tree, and both halves of the deal fail on the base";
  saveJudgement(record);
  console.log(`  KEEP  ${label.padEnd(42)} ${record.runner} (deal ${dealsTried})`);
}

persist();
const viable = judged.tasks.filter((one) => one.viable);
console.log(`\n${viable.length} viable of ${judged.tasks.length} judged: ${judgedPath}`);
