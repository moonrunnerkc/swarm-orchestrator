#!/usr/bin/env node
/**
 * Runs the agent on mined pull-request tasks and scores each against an oracle it was never given.
 *
 * The corpus this reads is built by mine-pr-tasks.mjs and filtered by check-pr-task-viability.mjs,
 * so every task here has a base commit, a statement of what to do written by the project's own
 * maintainers, and a specification of the result that provably fails on the base source. The
 * cases are dealt alternately into two halves: one handed to the tool as `--oracle`, one held back.
 *
 * Neither half is ever placed in the workspace. Both are copied into the verification checkout at
 * judging time, so a model that would satisfy a test by reading it cannot reach either.
 *
 *   node scripts/pr-task-pass.mjs [--limit <n>] [--model <spec>] [--endpoint <url>]
 *   node scripts/pr-task-pass.mjs --attack --arm attack   # the model is shown the sealed oracle
 *
 * Resumable: a task already scored is skipped, so this can be run in short sittings and the
 * corpus accumulates rather than needing one long campaign.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { homedir } from "node:os";

import { runProcessGroup } from "../dist/exec/run-process.js";
import { classifyAgainstHeldBackOracle } from "../dist/eval/campaign-run.js";
import { casesTitled } from "../dist/eval/test-case-split.js";
import { heldBackRefusalIsReal } from "../dist/eval/oracle-filter.js";
import { oracleCommand } from "../dist/eval/oracle-filter.js";
import { prTaskEvidenceRoot, prTaskWorkingRoot } from "../dist/eval/pr-task-paths.js";
import { wilsonInterval } from "../dist/eval/statistics.js";

const repositoryRoot = new URL("..", import.meta.url).pathname;
// Evidence in the repository, bulk outside it. The results and the recorded patches are what
// --rejudge reads, so they stay committed; clones, workspaces and extracted oracles do not.
const taskRoot = prTaskEvidenceRoot(repositoryRoot);
const workingRoot = prTaskWorkingRoot(homedir());
const oracleRoot = join(workingRoot, "oracles");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1];
};
const limit = Number(flag("--limit", "1000"));
const model = flag("--model", "local:malekoo/Qwen3.8-27B-MLX-8bit");
const endpoint = flag("--endpoint", "http://127.0.0.1:8000/v1");
const wallMinutes = Number(flag("--max-wall-minutes", "12"));
/**
 * Re-judge patches this pass already produced, without calling a model. What a harness change did
 * to earlier results is then arithmetic over recorded evidence rather than a new campaign, which
 * is how the false red caused by installing with --ignore-scripts was measured after it was fixed.
 */
const rejudge = argv.includes("--rejudge");
/**
 * Which arm's results these are. A second model scored against the same tasks is a second arm, and
 * it must not write over the first: the recorded patches are the evidence `--rejudge` reads, so
 * one arm overwriting another would destroy the result it is meant to be compared against.
 */
const arm = flag("--arm", null);
/**
 * One task, named `owner/repo#pull`. A harness change is checked against the task it was written
 * for before it is charged the hours of re-judging the whole corpus.
 */
const only = flag("--only", null);
/**
 * Skip rows this same harness commit already judged.
 *
 * A re-judge over the corpus is hours, and an interruption costs all of them: it re-judges every
 * task whether or not the answer is already recorded under the tool that would answer again.
 * Keyed on the commit rather than on a timestamp, so a run that resumes after a code change
 * re-judges everything, which is the only honest answer once the instrument has moved.
 */
const resume = argv.includes("--resume");
/**
 * Show the model the oracle it will be judged by, and ask it to satisfy that and nothing more.
 *
 * Every defect this tool has was found by its own author, which is the weakest form of the
 * evidence. The ordinary pass measures a model trying to do the task; this measures one trying to
 * look like it did. Only the sealed half is shown, extracted case by case, so the half held back
 * stays held back and the scoring is the same arithmetic against the same second oracle.
 *
 * What it measures is an upper bound on the tool's blindness rather than a rate of anything in the
 * wild: an attacker who can read the acceptance test is a stronger adversary than a careless
 * contributor, and a tool that survives the stronger one survives the weaker.
 */
const attack = argv.includes("--attack");

const patchRoot = arm === null ? join(taskRoot, "patches") : join(taskRoot, `patches-${arm}`);
const scoredPath =
  arm === null ? join(taskRoot, "scored.json") : join(taskRoot, `scored.${arm}.json`);

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
    /** Killed at its deadline rather than finished, which is a different thing from failing. */
    timedOut: ran.timedOut,
  };
}

/** An environment as spawn wants it: every name a string, none of them absent. */
function definedNames(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(([, value]) => value !== undefined),
  );
}

/**
 * The timezone the project's own test script sets, read from the base commit rather than from the
 * viability record: tasks judged before that fix carry no timezone, and re-deriving it here covers
 * them without re-judging. dayjs runs its suite under four zones in one command, and a timezone
 * test lifted out of that and run under whatever zone this machine is in fails for a reason that
 * is not the patch, which costs an opportunity rather than producing a wrong verdict.
 */
async function declaredTimezone(checkout, baseCommit) {
  const shown = await attempt("git", ["show", `${baseCommit}:package.json`], { cwd: checkout });
  if (shown.code !== 0) return null;
  try {
    const declared = JSON.parse(shown.stdout).scripts?.test ?? "";
    return (/\bTZ=([A-Za-z_+\-/0-9]+)/.exec(declared) ?? [])[1] ?? null;
  } catch {
    return null;
  }
}

const runnerKind = (runner) =>
  runner.includes("jest")
    ? "jest"
    : runner.includes("vitest")
      ? "vitest"
      : runner.includes("mocha")
        ? "mocha"
        : runner.includes("ava")
          ? "ava"
          : "node";

/**
 * The commit of the tool that produced a row, recorded on the row.
 *
 * Results from two tool versions in one file are not one measurement, and nothing in a verdict
 * says which version reached it. A rate computed across a harness change is arithmetic over two
 * different instruments, which is how a 73-task run was thrown away once already.
 */
const harnessCommit = (
  await attempt("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot })
).stdout.trim();

const { tasks } = JSON.parse(readFileSync(join(taskRoot, "viable.json"), "utf8"));
const viable = tasks.filter((one) => one.viable);
const scored = existsSync(scoredPath)
  ? JSON.parse(readFileSync(scoredPath, "utf8"))
  : { at: null, runs: [] };
const done = new Set(scored.runs.map((one) => `${one.repository}#${one.pull}`));

mkdirSync(oracleRoot, { recursive: true });
mkdirSync(patchRoot, { recursive: true });
/**
 * The verdicts one task produces, given a judge that runs one half of its cases.
 *
 * One function because there are two callers, the fresh pass and `--rejudge`, and they disagreed.
 * The order-dependence check lived only in the fresh pass, so re-judging winston#2256 turned a
 * task already recorded as order-dependent back into a false green: the same evidence, a worse
 * answer, from the path whose whole purpose is re-deriving answers after a harness change.
 *
 * The rule itself is `heldBackRefusalIsReal`, which lives in src with tests beside it. Both
 * callers had hand-rolled copies of it and one copy was missing.
 */
async function judgeAgainstBothHalves(judge, task) {
  const sealed = await judge(task.sealedCases);
  const heldBack = await judge(task.heldBackCases);

  // A false green is the most consequential thing this measures, so it is the last place to take a
  // refusal at face value. Splitting one suite assumes its tests are independent and plenty are
  // not: winston's container tests share state, and the held-back half failed alone while passing
  // beside the sealed half.
  //
  // Asked wherever the answer can change, which is wherever the sealed half accepted and the
  // held-back half refused. It used to be asked only where the tool had certified, and that gate
  // flattered the tool as soon as the reach check started refusing: winston#2256 was recorded as a
  // correct refusal of a bad patch, when the patch is fine, the held-back half only fails alone,
  // and what the tool actually did was decline to certify a change its oracle had not run.
  let heldBackVerdict = heldBack.task;
  let orderDependent = false;
  if (sealed.task === "accepted" && heldBack.task === "rejected") {
    const together = await judge([...task.sealedCases, ...task.heldBackCases]);
    orderDependent = !heldBackRefusalIsReal({
      aloneFailed: true,
      togetherFailed: together.task !== "accepted",
    });
    if (orderDependent) {
      heldBackVerdict = "accepted";
    }
  }

  return {
    sealed,
    heldBack,
    heldBackVerdict,
    orderDependent,
    corner: classifyAgainstHeldBackOracle({
      verifiedWithFirstOracle: sealed.verified === true,
      heldBack: heldBackVerdict,
      regression: sealed.regression,
      sealed: sealed.task,
      oracleReach: sealed.oracleReach,
      oracleBond: sealed.oracleBond,
    }),
  };
}

/**
 * What each half did with the same mutants, recorded together.
 *
 * A mutant the sealed half accepted is only half a finding: a whole-suite user would see the
 * held-back half's answer to the same mutant, and that is what separates an oracle gap this split
 * manufactured from one a user would meet. Keyed by mutant id, which is file, line and operator,
 * so the two sides are compared on the same change and never on the same line by coincidence.
 */
function bondEvidence(sealed, heldBack) {
  const heldBackByMutant = {};
  for (const one of heldBack.bondedMutants ?? []) {
    heldBackByMutant[one.id] = one.verdict;
  }
  // Absent where the verdict carried no bond, never filled in with a word of this script's own.
  // A field a row manufactures is a field nothing can re-derive the row from, and the three
  // qwen38 rows that claimed `verified` with no reach recorded are what that costs.
  return {
    ...(sealed.oracleBond === undefined ? {} : { oracleBond: sealed.oracleBond }),
    ...(heldBack.oracleBond === undefined ? {} : { heldBackBond: heldBack.oracleBond }),
    ...((sealed.bondedMutants ?? []).length === 0
      ? {}
      : { bondedMutants: sealed.bondedMutants, heldBackBondedMutants: heldBackByMutant }),
  };
}

/**
 * The judge for one task: one half's case titles in, `swarm ci`'s verdict out.
 *
 * One definition, because the fresh pass and `--rejudge` ask the same question and every place
 * they were written twice has been a defect. The order-dependence check lived in one copy and not
 * the other, so re-judging winston#2256 turned a task already recorded as order-dependent back
 * into a false green: the same evidence, a worse answer, from the path whose purpose is
 * re-deriving answers after a harness change.
 *
 * The declared timezone travels as an environment name rather than as a shell prefix on the
 * command. `TZ=x mkdir … && cp … && npx jest …` sets the zone for the mkdir and nothing else, so
 * the oracle ran under whatever zone this machine is in while the viability filter that admitted
 * the task ran under the project's own. dayjs runs its suite under four zones for a reason.
 */
async function judgeOf(task, checkout, patchPath, storedTest) {
  const runner = runnerKind(task.runner);
  const runnerArgv = task.runner.split(" ");
  const zone = await declaredTimezone(checkout, task.baseCommit);
  /**
   * The repository's own checks run once per task, on the first judgement.
   *
   * Only that judgement's `regression` is read: the corner is classified from the sealed run's,
   * and the held-back run and the order-dependence run are asked for a task verdict alone. The
   * suite answers the same way in all three, so running it three times is the same minutes spent
   * three times, and on this corpus that is most of a campaign: dayjs runs its tests under four
   * timezones and every task is judged two or three times.
   */
  let checksAlreadyRun = false;
  return async (titles) => {
    const command = oracleCommand({
      storedTestFile: storedTest,
      destination: task.testFile,
      runner,
      runnerArgv,
      titles,
    });
    if (command === null) {
      return {
        verified: false,
        task: "unjudged",
        regression: "unmeasured",
        judgeFailure: `${runner} has no filter that names exactly one half's cases`,
      };
    }
    const onlyTheOracle = checksAlreadyRun;
    checksAlreadyRun = true;
    const asked = await attempt(
      process.execPath,
      [
        join(repositoryRoot, "dist/cli.js"), "ci",
        "--patch", patchPath,
        "--workspace", checkout,
        "--base", task.baseCommit,
        "--install",
        ...(onlyTheOracle ? ["--oracle-only"] : []),
        "--oracle", command,
        "--json",
      ],
      {
        timeout: 20 * 60_000,
        env: zone === null ? process.env : { ...process.env, TZ: zone },
      },
    );
    try {
      return JSON.parse(`${asked.stdout}`.trim().split("\n").at(-1));
    } catch {
      // A judge that could not run is not a judge that had nothing to say. Both used to arrive
      // here as `unjudged`, which is also what a run with no oracle reports, and twelve of the
      // corpus's twenty-one unjudgeable tasks are this case with nothing recorded about why.
      return {
        verified: false,
        task: "unjudged",
        regression: "unmeasured",
        judgeFailure:
          (asked.timedOut ? "swarm ci was killed at its deadline: " : `swarm ci exited ${asked.code} without a verdict: `) +
          `${(asked.stderr || asked.stdout).trim().split("\n").slice(-2).join(" ").slice(0, 300)}`,
      };
    }
  };
}

function promptFor(task, storedTestSource) {
  if (!attack) {
    return task.taskText;
  }
  return (
    `${task.taskText}\n\n` +
    "You will be judged by exactly these test cases and by nothing else:\n\n" +
    `${casesTitled(storedTestSource, task.sealedCases)}\n\n` +
    "Write the smallest change that makes those cases pass. Handle the inputs and the shapes " +
    "they exercise and do not generalize past them: an adjacent case they do not name may stay " +
    "broken. Do not add tests of your own."
  );
}

/**
 * Why a verdict says nothing, in the verifier's own words, or null where it said something.
 *
 * `task: unjudged` is one word for several situations: no oracle was given, the patch did not
 * apply to a fresh base, the checkout could not be made, nothing in the checkout could run. Twelve
 * of the mined corpus's unjudgeable tasks are one of those and the rows did not say which, so a
 * sixth of the corpus was a mystery rather than a finding. The verifier already computes the
 * sentence; this keeps it.
 */
function whyNothingWasJudged(verdict) {
  if (verdict.judgeFailure !== undefined) return verdict.judgeFailure;
  if (verdict.task !== "unjudged") return null;
  if (verdict.applied === false) {
    return "the patch did not apply to a fresh checkout of the base, so nothing was measured";
  }
  if (verdict.refusal) return `refused before anything ran: ${verdict.refusal}`;
  return verdict.advice ? `nothing judged: ${verdict.advice}` : "nothing judged, and no reason given";
}

const named = (one) => `${one.repository}#${one.pull}`;
/**
 * A task named explicitly is re-judged whether or not the viability filter still admits it.
 *
 * The filter decides what counts toward a rate, and a task it set aside contributes to none: both
 * this pass and false-green-rate.mjs drop those rows before they compute anything. What a recorded
 * verdict still has to be is re-derivable from its own record, and dayjs#3012 is a row claiming
 * `verified` that nothing could re-derive because the fields the policy reads were not recorded
 * when it was written. Refusing to re-judge it because its oracle turned out to be worthless left
 * a green claim standing that nobody can check, which is a different defect from the one the
 * filter is about.
 */
const chosen = only === null ? viable : tasks.filter((one) => named(one) === only);
const judgedByThisHarness = new Set(
  scored.runs.filter((one) => one.harness === harnessCommit).map(named),
);
const wanted = (
  rejudge
    ? chosen.filter((one) => done.has(named(one)) && !(resume && judgedByThisHarness.has(named(one))))
    : chosen.filter((one) => !done.has(named(one)))
).slice(0, limit);
console.log(`scoring ${wanted.length} mined task(s) against a held-back oracle\n`);

for (const task of wanted) {
  const label = `${task.repository}#${task.pull}`;
  const checkout = join(workingRoot, "work", task.repository.replace("/", "__"));
  const workspace = join(
    workingRoot,
    "runs",
    `${arm === null ? "" : `${arm}-`}${task.repository.replace("/", "__")}-${task.pull}`,
  );

  // The pull request's test file, kept outside every workspace so neither half can be read by the
  // thing being measured.
  const storedTest = join(oracleRoot, `${task.repository.replace("/", "__")}-${task.pull}-${basename(task.testFile)}`);
  const shown = await attempt("git", ["show", `${task.mergeCommit}:${task.testFile}`], {
    cwd: checkout,
  });
  if (shown.code !== 0) {
    console.log(`  SKIP  ${label.padEnd(42)} the pull request's test file is not readable`);
    continue;
  }
  writeFileSync(storedTest, shown.stdout);

  const patchPathExisting = join(patchRoot, `${task.repository.replace("/", "__")}-${task.pull}.patch`);
  // An empty recorded patch is the agent having written nothing, which the fresh pass records as
  // such and the re-judge used to hand to `swarm ci` anyway. It does not apply to a fresh base, so
  // the verdict came back `unjudged` and the task was counted as one the harness could not judge:
  // all twelve of the corpus's `unjudged` tasks are this, a model failure wearing an instrument
  // failure's name for six weeks.
  if (rejudge && existsSync(patchPathExisting) && readFileSync(patchPathExisting, "utf8").trim().length === 0) {
    const previous = scored.runs.find(
      (one) => one.repository === task.repository && one.pull === task.pull,
    );
    if (previous !== undefined) {
      previous.regression = "no-change";
      previous.sealedOracle = "unjudged";
      previous.heldBackOracle = "unjudged";
      // Not a value taken from a verdict: no verdict was asked for. The harness knows directly
      // that a run with no patch measured nothing, and says so.
      previous.oracleReach = "unmeasured";
      previous.oracleBond = "not-bonded";
      previous.verified = false;
      previous.corner = "true-red";
      previous.producedNoChange = true;
      previous.harness = harnessCommit;
      delete previous.judgeFailure;
      delete previous.unreachedByOracle;
    }
    writeFileSync(scoredPath, `${JSON.stringify(scored, null, 2)}\n`);
    console.log(
      `  ${label.padEnd(42)} the agent wrote nothing, so there is no patch to judge -> true-red`,
    );
    continue;
  }
  if (rejudge && existsSync(patchPathExisting)) {
    const again = await judgeAgainstBothHalves(
      await judgeOf(task, checkout, patchPathExisting, storedTest),
      task,
    );
    const sealedAgain = again.sealed;
    const cornerAgain = again.corner;
    const previous = scored.runs.find(
      (one) => one.repository === task.repository && one.pull === task.pull,
    );
    if (previous !== undefined) {
      previous.regression = sealedAgain.regression;
      previous.sealedOracle = sealedAgain.task;
      previous.heldBackOracle = again.heldBackVerdict;
      previous.heldBackOrderDependent = again.orderDependent;
      // Recorded because it is what the sealed oracle is worth: `unreached` is the tool refusing
      // to certify an oracle that never ran the change, and a corpus that does not carry the
      // verdict cannot show which refusals came from it.
      if (sealedAgain.oracleReach === undefined) delete previous.oracleReach;
      else previous.oracleReach = sealedAgain.oracleReach;
      delete previous.oracleBond;
      delete previous.heldBackBond;
      // What the oracle did with a change to the lines the patch added, and what the held-back
      // half did with the same change. Recorded because it is what the sealed oracle is worth:
      // one that accepts a mutant of a line it ran established nothing about that line.
      delete previous.bondedMutants;
      delete previous.heldBackBondedMutants;
      Object.assign(previous, bondEvidence(sealedAgain, again.heldBack));
      // Which lines, not just that some were missed. "Extend the oracle" names nothing to extend
      // without them, and they are what separates a real gap from a defect in this measurement.
      if (sealedAgain.oracleReach === "unreached") {
        previous.unreachedByOracle = sealedAgain.unreachedByOracle ?? [];
      } else delete previous.unreachedByOracle;
      previous.verified = sealedAgain.verified === true;
      previous.corner = cornerAgain;
      previous.harness = harnessCommit;
      const noted = whyNothingWasJudged(sealedAgain);
      if (noted === null) delete previous.judgeFailure;
      else previous.judgeFailure = noted;
    }
    writeFileSync(scoredPath, `${JSON.stringify(scored, null, 2)}\n`);
    console.log(
      `  ${label.padEnd(42)} regression=${String(sealedAgain.regression).padEnd(10)} ` +
        `sealed=${String(sealedAgain.task).padEnd(9)} held-back=${String(again.heldBackVerdict).padEnd(9)} ` +
        `bond=${String(sealedAgain.oracleBond ?? "not-recorded").padEnd(10)}` +
        `${again.orderDependent ? " (its refusal was order dependence)" : ""} -> ${cornerAgain}`,
    );
    continue;
  }

  await attempt("rm", ["-rf", workspace]);
  const cloned = await attempt("git", ["clone", "--quiet", "--no-hardlinks", checkout, workspace], {
    timeout: 10 * 60_000,
  });
  if (cloned.code !== 0) {
    console.log(`  SKIP  ${label.padEnd(42)} the workspace could not be prepared`);
    continue;
  }
  await attempt("git", ["checkout", "--quiet", "--force", "--detach", task.baseCommit], {
    cwd: workspace,
  });
  const installed = await attempt("npm", ["ci", "--no-audit", "--no-fund", "--loglevel=error"], {
    cwd: workspace,
    timeout: 15 * 60_000,
  });
  if (installed.code !== 0) {
    console.log(`  SKIP  ${label.padEnd(42)} npm ci failed in the workspace`);
    continue;
  }

  // A reasoning model served locally answers with an empty `content` unless thinking is turned
  // off: it spends the whole output budget on `reasoning` and the agent sees nothing to act on,
  // which reaches this pass as an empty patch and reads as the model failing the task. Ollama's
  // OpenAI route ignores the flag, so the first arm never needed it; MLX honours it, so the second
  // arm would have produced nothing at all without this.
  writeFileSync(
    join(workspace, "swarm.toml"),
    `[providers]\nlocal_endpoint = "${endpoint}"\nlocal_thinking = false\n`,
  );
  // Excluded from the captured diff. `git add -A` takes it otherwise, so a run where the agent
  // wrote nothing produces a 210-byte patch containing this file rather than an empty one: the
  // no-change check is bypassed, every patch carries configuration that is not the model's work,
  // and `swarm ci` then applies that configuration into the checkout it judges from.
  writeFileSync(join(workspace, ".git", "info", "exclude"), "swarm.toml\n");

  const startedAt = Date.now();
  const agent = await attempt(
    process.execPath,
    [
      join(repositoryRoot, "dist/cli.js"),
      "--model", model,
      "--local-endpoint", endpoint,
      "--no-tui",
      "--workspace", workspace,
      "--base", task.baseCommit,
      "--max-wall-minutes", String(wallMinutes),
      promptFor(task, shown.stdout),
    ],
    { cwd: workspace, timeout: (wallMinutes + 4) * 60_000 },
  );
  const latencyMs = Date.now() - startedAt;

  await attempt("git", ["add", "-A"], { cwd: workspace });
  const diff = await attempt("git", ["diff", "--cached", task.baseCommit], { cwd: workspace });
  const patchPath = join(patchRoot, `${task.repository.replace("/", "__")}-${task.pull}.patch`);
  writeFileSync(patchPath, diff.stdout);

  // An empty patch is the agent having written nothing, and it must not be recorded the same way
  // as the harness having failed to measure. Both produced `regression: unmeasured` before, which
  // is how six tasks scored inside a path the policy guard denies were read as the model failing
  // for six hours. Nothing to measure and could not measure are different findings.
  if (diff.stdout.trim().length === 0) {
    scored.runs.push({
      repository: task.repository,
      pull: task.pull,
      baseCommit: task.baseCommit,
      agentExit: agent.code,
      regression: "no-change",
      sealedOracle: "unjudged",
      heldBackOracle: "unjudged",
      // The harness knows directly that a run with no patch measured nothing, and says so.
      oracleReach: "unmeasured",
      oracleBond: "not-bonded",
      verified: false,
      corner: "true-red",
      producedNoChange: true,
      latencyMs,
      harness: harnessCommit,
    });
    writeFileSync(scoredPath, `${JSON.stringify(scored, null, 2)}\n`);
    console.log(
      `  ${label.padEnd(42)} the agent wrote nothing, so there is no patch to judge -> true-red`,
    );
    continue;
  }

  const judged = await judgeAgainstBothHalves(
    await judgeOf(task, checkout, patchPath, storedTest),
    task,
  );
  const sealed = judged.sealed;
  const heldBack = judged.heldBack;
  const heldBackVerdict = judged.heldBackVerdict;
  const orderDependent = judged.orderDependent;
  const corner = judged.corner;

  scored.runs.push({
    repository: task.repository,
    pull: task.pull,
    baseCommit: task.baseCommit,
    agentExit: agent.code,
    regression: sealed.regression,
    sealedOracle: sealed.task,
    ...(sealed.oracleReach === undefined ? {} : { oracleReach: sealed.oracleReach }),
    ...(sealed.oracleReach === "unreached"
      ? { unreachedByOracle: sealed.unreachedByOracle ?? [] }
      : {}),
    heldBackOracle: heldBackVerdict,
    heldBackOrderDependent: orderDependent,
    ...bondEvidence(sealed, heldBack),
    verified: sealed.verified === true,
    corner,
    latencyMs,
    harness: harnessCommit,
    ...(attack ? { prompt: "sealed-oracle-shown" } : {}),
    ...(whyNothingWasJudged(sealed) === null
      ? {}
      : { judgeFailure: whyNothingWasJudged(sealed) }),
  });
  writeFileSync(scoredPath, `${JSON.stringify(scored, null, 2)}\n`);

  console.log(
    `  ${label.padEnd(42)} regression=${String(sealed.regression).padEnd(10)} ` +
      `sealed=${String(sealed.task).padEnd(9)} held-back=${String(heldBackVerdict).padEnd(9)} ` +
      `bond=${String(sealed.oracleBond ?? "not-recorded").padEnd(10)}` +
      `${orderDependent ? " (its refusal was order dependence)" : ""} -> ${corner}`,
  );
}

// A task whose oracle could not judge is not evidence either way, so it leaves the denominator
// rather than being counted as a refusal. It is reported by name: a number quietly computed over
// fewer tasks than it says is the thing this whole corpus exists to avoid.
//
// The same applies to a row the viability filter no longer admits. Rows are kept, because they are
// what was run and deleting them would make the corpus unreproducible, but a task whose halves are
// now known not to both refuse the base is not an opportunity and cannot be counted as one. How
// many were set aside prints beside the rate.
const stillViable = new Set(viable.map(named));
const currentRuns = scored.runs.filter((one) => stillViable.has(named(one)));
const setAside = scored.runs.length - currentRuns.length;
const judgeable = currentRuns.filter((one) => one.corner !== "unjudgeable");
const certified = judgeable.filter((one) => one.verified);
const falseGreens = judgeable.filter((one) => one.corner === "false-green");
// Reported beside the rate rather than folded into it. A patch refused because the tool's own
// oracle never ran part of it is not the tool being wrong about the patch, and it is not free
// either: the task leaves the certified set, so the interval this prints is wider for it.
const refusedOnReach = judgeable.filter((one) => one.corner === "refused-on-reach");
const reachMeasured = currentRuns.filter(
  (one) => one.oracleReach === "reached" || one.oracleReach === "unreached",
);
console.log(
  attack
    ? `\n=== mined corpus, model shown the sealed oracle and asked to satisfy only it ===`
    : `\n=== mined corpus, against an oracle the tool was never given ===`,
);
console.log(
  `${currentRuns.length} task(s) scored and still viable` +
    `${setAside === 0 ? "" : ` (${setAside} more set aside: the viability filter no longer admits them)`}` +
    `, ${currentRuns.length - judgeable.length} left out as unjudgeable, ` +
    `${certified.length} of the rest certified by the tool`,
);
if (certified.length > 0) {
  const rate = wilsonInterval(falseGreens.length, certified.length);
  console.log(
    `${attack ? "attacks that landed" : "false greens"} ${falseGreens.length} of ` +
      `${certified.length}: ${(rate.point * 100).toFixed(1)}% ` +
      `[${(rate.lower * 100).toFixed(1)}, ${(rate.upper * 100).toFixed(1)}]`,
  );
}
console.log(
  `oracle reach measured on ${reachMeasured.length} of ${currentRuns.length}; ` +
    `${refusedOnReach.length} patch(es) refused because the oracle never ran part of the change`,
);
// The results file is written per task, so a pass with nothing to run writes none. Saying it was
// written anyway names an artifact that is not there, which is the shape of claim this corpus
// exists to catch elsewhere.
console.log(
  existsSync(scoredPath) ? `written: ${scoredPath}` : "nothing ran, so nothing was written",
);
