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
 *
 * Resumable: a task already scored is skipped, so this can be run in short sittings and the
 * corpus accumulates rather than needing one long campaign.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";

import { homedir } from "node:os";

import { classifyAgainstHeldBackOracle } from "../dist/eval/campaign-run.js";
import { heldBackRefusalIsReal } from "../dist/eval/oracle-filter.js";
import { oracleCommand } from "../dist/eval/oracle-filter.js";
import { prTaskEvidenceRoot, prTaskWorkingRoot } from "../dist/eval/pr-task-paths.js";
import { wilsonInterval } from "../dist/eval/statistics.js";

const run = promisify(execFile);
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

const patchRoot = arm === null ? join(taskRoot, "patches") : join(taskRoot, `patches-${arm}`);
const scoredPath =
  arm === null ? join(taskRoot, "scored.json") : join(taskRoot, `scored.${arm}.json`);

async function attempt(file, args, options = {}) {
  try {
    const done = await run(file, args, { maxBuffer: 64 * 1024 * 1024, ...options });
    return { code: 0, stdout: done.stdout, stderr: done.stderr };
  } catch (cause) {
    return {
      code: typeof cause.code === "number" ? cause.code : 1,
      stdout: `${cause.stdout ?? ""}`,
      stderr: `${cause.stderr ?? cause.message ?? ""}`,
    };
  }
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
  // beside the sealed half. Asked only where it could change the answer, which is a certified run
  // the held-back half refused, so it costs one extra run on the tasks where being wrong matters.
  let heldBackVerdict = heldBack.task;
  let orderDependent = false;
  if (sealed.verified === true && heldBack.task === "rejected") {
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
    }),
  };
}

const named = (one) => `${one.repository}#${one.pull}`;
const chosen = only === null ? viable : viable.filter((one) => named(one) === only);
const wanted = (rejudge ? chosen.filter((one) => done.has(named(one))) : chosen.filter((one) => !done.has(named(one)))).slice(0, limit);
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
  if (rejudge && existsSync(patchPathExisting)) {
    const kindOnly = runnerKind(task.runner);
    const argvOnly = task.runner.split(" ");
    const zoneOnly = await declaredTimezone(checkout, task.baseCommit);
    const judgeOnly = async (titles) => {
      const built = oracleCommand({
        storedTestFile: storedTest,
        destination: task.testFile,
        runner: kindOnly,
        runnerArgv: argvOnly,
        titles,
      });
      const command = zoneOnly === null ? built : `TZ=${zoneOnly} ${built}`;
      const asked = await attempt(
        process.execPath,
        [
          join(repositoryRoot, "dist/cli.js"), "ci",
          "--patch", patchPathExisting,
          "--workspace", checkout,
          "--base", task.baseCommit,
          "--install",
          "--oracle", command,
          "--json",
        ],
        { timeout: 20 * 60_000 },
      );
      try {
        return JSON.parse(`${asked.stdout}`.trim().split("\n").at(-1));
      } catch {
        return { verified: false, task: "unjudged", regression: "unmeasured" };
      }
    };
    const again = await judgeAgainstBothHalves(judgeOnly, task);
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
      previous.oracleReach = sealedAgain.oracleReach ?? "unmeasured";
      previous.verified = sealedAgain.verified === true;
      previous.corner = cornerAgain;
    }
    writeFileSync(scoredPath, `${JSON.stringify(scored, null, 2)}\n`);
    console.log(
      `  ${label.padEnd(42)} regression=${String(sealedAgain.regression).padEnd(10)} ` +
        `sealed=${String(sealedAgain.task).padEnd(9)} held-back=${String(again.heldBackVerdict).padEnd(9)} -> ${cornerAgain}`,
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
      task.taskText,
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
      verified: false,
      corner: "true-red",
      producedNoChange: true,
      latencyMs,
    });
    writeFileSync(scoredPath, `${JSON.stringify(scored, null, 2)}\n`);
    console.log(
      `  ${label.padEnd(42)} the agent wrote nothing, so there is no patch to judge -> true-red`,
    );
    continue;
  }

  const kind = runnerKind(task.runner);
  const runnerArgv = task.runner.split(" ");
  const zone = await declaredTimezone(checkout, task.baseCommit);
  const judge = async (titles) => {
    const built = oracleCommand({
      storedTestFile: storedTest,
      destination: task.testFile,
      runner: kind,
      runnerArgv,
      titles,
    });
    const command = zone === null ? built : `TZ=${zone} ${built}`;
    const asked = await attempt(
      process.execPath,
      [
        join(repositoryRoot, "dist/cli.js"), "ci",
        "--patch", patchPath,
        "--workspace", checkout,
        "--base", task.baseCommit,
        "--install",
        "--oracle", command,
        "--json",
      ],
      { timeout: 20 * 60_000 },
    );
    try {
      return JSON.parse(`${asked.stdout}`.trim().split("\n").at(-1));
    } catch {
      return { verified: false, task: "unjudged", regression: "unmeasured" };
    }
  };

  const judged = await judgeAgainstBothHalves(judge, task);
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
    oracleReach: sealed.oracleReach ?? "unmeasured",
    heldBackOracle: heldBackVerdict,
    heldBackOrderDependent: orderDependent,
    verified: sealed.verified === true,
    corner,
    latencyMs,
  });
  writeFileSync(scoredPath, `${JSON.stringify(scored, null, 2)}\n`);

  console.log(
    `  ${label.padEnd(42)} regression=${String(sealed.regression).padEnd(10)} ` +
      `sealed=${String(sealed.task).padEnd(9)} held-back=${String(heldBack.task).padEnd(9)} -> ${corner}`,
  );
}

// A task whose oracle could not judge is not evidence either way, so it leaves the denominator
// rather than being counted as a refusal. It is reported by name: a number quietly computed over
// fewer tasks than it says is the thing this whole corpus exists to avoid.
const judgeable = scored.runs.filter((one) => one.corner !== "unjudgeable");
const certified = judgeable.filter((one) => one.verified);
const falseGreens = judgeable.filter((one) => one.corner === "false-green");
console.log(`\n=== mined corpus, against an oracle the tool was never given ===`);
console.log(
  `${scored.runs.length} task(s) scored, ${scored.runs.length - judgeable.length} left out as ` +
    `unjudgeable, ${certified.length} of the rest certified by the tool`,
);
if (certified.length > 0) {
  const rate = wilsonInterval(falseGreens.length, certified.length);
  console.log(
    `false greens ${falseGreens.length} of ${certified.length}: ` +
      `${(rate.point * 100).toFixed(1)}% [${(rate.lower * 100).toFixed(1)}, ${(rate.upper * 100).toFixed(1)}]`,
  );
}
console.log(`written: ${scoredPath}`);
