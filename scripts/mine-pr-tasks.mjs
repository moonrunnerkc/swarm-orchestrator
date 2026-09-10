#!/usr/bin/env node
/**
 * Mines tasks with two oracles out of merged pull requests.
 *
 * Gate 3 wants zero false greens over hundreds of tasks, and a task needs a base commit, a
 * statement of what to do, an oracle handed to the tool and a second held back from it. Writing
 * four hundred of those by hand is the corpus campaign this avoids. A merged pull request that
 * adds a feature with tests already carries all four: its parent is the base, its title and body
 * are the task, and the test cases it added are a specification its own maintainers wrote, split
 * alternately into the two oracles.
 *
 * This phase is API only and cheap. It proposes candidates; it does not establish that any of
 * them work, which is what check-pr-task-viability.mjs does by running them.
 *
 *   node scripts/mine-pr-tasks.mjs [--repos <n>] [--per-repo <n>] [--out <file>]
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { prTaskEvidenceRoot } from "../dist/eval/pr-task-paths.js";
import { splitTestCases } from "../dist/eval/test-case-split.js";

const run = promisify(execFile);
const repositoryRoot = new URL("..", import.meta.url).pathname;

const argv = process.argv.slice(2);
const numeric = (flag, fallback) => {
  const at = argv.indexOf(flag);
  return at === -1 ? fallback : Number(argv[at + 1]);
};
const outAt = argv.indexOf("--out");
const outPath =
  outAt === -1 ? join(prTaskEvidenceRoot(repositoryRoot), "candidates.json") : argv[outAt + 1];

const isTestPath = (path) =>
  /(^|\/)(__tests__|tests?|spec)\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
const isSourcePath = (path) =>
  /\.[cm]?[jt]sx?$/.test(path) && !isTestPath(path) && !/\.d\.ts$/.test(path);

async function gh(path, parameters = {}) {
  const query = Object.entries(parameters)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  const { stdout } = await run("gh", ["api", query ? `${path}?${query}` : path], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

/**
 * How many API calls are left, asked before a repository rather than discovered by failing.
 *
 * A rate-limited call lands in the same catch as a pull request with no readable files, so a run
 * that ran out of budget mines nothing and says it found no candidates. That is a corpus quietly
 * smaller than the command that produced it claims, which is the one thing this corpus cannot
 * afford: the denominator is the measurement.
 */
async function callsRemaining() {
  try {
    return (await gh("rate_limit")).resources.core.remaining;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * The task text a run is given. Code blocks come out because a body that pastes the patch hands
 * the model the answer, and a task whose text contains its own solution measures nothing.
 */
function taskTextFrom(pull) {
  const body = (pull.body ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    // What a stripped cross-reference leaves behind. A body that is mostly "part of #1234" and
    // "closes #567" reduces to a string of dangling connectives: refined-github#9832 became
    // "`extensible-nav` - Allow extension by other features. - part of - part of", which is not a
    // task, and the model reasonably wrote nothing.
    .replace(/\b(part of|closes?|fixes?|refs?|see|related to)\b[\s.,;:-]*(?=(\s|$))/gi, " ")
    .replace(/[\s-]*[-–—][\s-]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${pull.title.trim()}. ${body}`.trim().slice(0, 1200);
}

/**
 * Whether what the model will actually be given says enough to act on. The length check that ran
 * before this measured the raw body, so a pull request whose body was mostly links passed it and
 * then reduced to nothing once the links were stripped. Measure what is handed over, not what it
 * was made from.
 */
function saysEnoughToActOn(taskText) {
  return taskText.length >= 80;
}

/** The lines a diff added, which for a test file is the cases the pull request wrote. */
function addedLines(patch) {
  return (patch ?? "")
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
}

const selection = JSON.parse(
  readFileSync(join(repositoryRoot, "campaign/selection/repos.json"), "utf8"),
);
const repositories = (Array.isArray(selection) ? selection : Object.values(selection)[0])
  .filter((one) => one.accepted !== false && /JavaScript|TypeScript/.test(one.language ?? ""))
  .slice(0, numeric("--repos", 12));

console.log(`mining ${repositories.length} repositories, API only\n`);

/**
 * What is already on disk, read once at the start so the file can be written after every
 * repository rather than at the end.
 *
 * The other two scripts in this pipeline save a judgement when it is made, for the reason this one
 * needed and did not have: a pass that dies on its last repository throws away every candidate
 * before it, and three hours of API budget with it.
 */
const already = existsSync(outPath)
  ? (JSON.parse(readFileSync(outPath, "utf8")).candidates ?? [])
  : [];
const nameOf = (one) => `${one.repository}#${one.pull}`;

const candidates = [];
function persist() {
  const found = new Set(candidates.map(nameOf));
  const merged = [...already.filter((one) => !found.has(nameOf(one))), ...candidates];
  writeFileSync(
    outPath,
    `${JSON.stringify({ at: new Date().toISOString(), candidates: merged }, null, 2)}\n`,
  );
  return merged.length;
}

/** Enough left to finish a repository, rather than stopping halfway through one. */
const budgetFloor = 200;
for (const repository of repositories) {
  const remaining = await callsRemaining();
  if (remaining < budgetFloor) {
    console.log(
      `\nstopped with ${repositories.length - repositories.indexOf(repository)} repositories ` +
        `unmined: ${remaining} API calls left, which is not enough to finish one. ` +
        "What is written is what was mined, and the rest is not missing, it is unasked.",
    );
    break;
  }
  // Several pages, because a repository's most recent hundred closed pulls are mostly
  // dependency bumps and documentation. Mining one page found nothing in twenty of fifty
  // repositories that do have usable pull requests further back.
  let pulls = [];
  try {
    for (let page = 1; page <= numeric("--pages", 4); page += 1) {
      const batch = await gh(`repos/${repository.fullName}/pulls`, {
        state: "closed",
        per_page: 100,
        page,
        sort: "updated",
        direction: "desc",
      });
      pulls.push(...batch);
      if (batch.length < 100) break;
    }
  } catch (cause) {
    console.log(`${repository.fullName.padEnd(40)} pulls unavailable: ${String(cause).slice(0, 80)}`);
    continue;
  }

  let found = 0;
  const wanted = numeric("--per-repo", 6);
  for (const pull of pulls) {
    if (found >= wanted) break;
    if (pull.merged_at === null || pull.merge_commit_sha === null) continue;
    if ((pull.body ?? "").trim().length < 40) continue;

    let files = [];
    try {
      files = await gh(`repos/${repository.fullName}/pulls/${pull.number}/files`, { per_page: 100 });
    } catch {
      continue;
    }
    const testFiles = files.filter((file) => isTestPath(file.filename) && file.patch !== undefined);
    const sourceFiles = files.filter((file) => isSourcePath(file.filename));
    if (testFiles.length === 0 || sourceFiles.length === 0) continue;

    // Size is the only difficulty dial available before running anything, and it cuts both ways.
    // A corpus of tasks no model can do measures nothing: a false green needs the tool to certify
    // a patch first, and the two tasks scored on 2026-09-06 were both algorithm implementations
    // the local model failed outright, so neither produced an opportunity. A corpus of only tiny
    // tasks measures the tool on tiny tasks. This is a flag rather than a constant so the shaping
    // is visible in the command that produced a corpus.
    const changed = files.reduce((total, file) => total + file.changes, 0);
    if (changed > numeric("--max-changed-lines", 400)) continue;

    // One test file per task, so the two oracles are halves of one specification rather than two
    // files that may not cover the same thing. Where a pull request touched several, the one whose
    // added cases split furthest is the one taken: the others are left rather than merged, because
    // merging them is what would make the two halves incomparable.
    const splits = testFiles
      .map((file) => ({ file, split: splitTestCases(addedLines(file.patch)) }))
      .filter((one) => one.split.splittable)
      .sort((a, b) => b.split.sealed.length + b.split.heldBack.length - (a.split.sealed.length + a.split.heldBack.length));
    const best = splits[0];
    if (best === undefined) continue;
    const onlyTestFile = best.file;
    const split = best.split;

    const taskText = taskTextFrom(pull);
    if (!saysEnoughToActOn(taskText)) continue;

    candidates.push({
      repository: repository.fullName,
      cloneUrl: repository.cloneUrl,
      pull: pull.number,
      mergeCommit: pull.merge_commit_sha,
      taskText,
      testFile: onlyTestFile.filename,
      sourceFiles: sourceFiles.map((file) => file.filename),
      changedLines: changed,
      sealedCases: split.sealed.map((one) => one.title),
      heldBackCases: split.heldBack.map((one) => one.title),
    });
    found += 1;
  }
  console.log(`${repository.fullName.padEnd(40)} ${found} candidate(s)`);
  persist();
}

// Added to what is already there rather than written over it: a second mining pass used to replace
// the file, so every candidate it did not happen to find again was gone, along with the viability
// judgement and the score that had been paid for it. A pull request is named once by owner,
// repository and number, so the merge is by that name.
console.log(`\n${candidates.length} candidate(s) this pass, ${persist()} in all: ${outPath}`);
console.log("None of these is known to work yet. Run scripts/check-pr-task-viability.mjs next.");
