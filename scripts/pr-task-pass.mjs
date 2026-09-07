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

import { classifyAgainstHeldBackOracle } from "../dist/eval/campaign-run.js";
import { oracleCommand } from "../dist/eval/oracle-filter.js";
import { wilsonInterval } from "../dist/eval/statistics.js";

const run = promisify(execFile);
const repositoryRoot = new URL("..", import.meta.url).pathname;
const taskRoot = join(repositoryRoot, "campaign/pr-tasks");
const oracleRoot = join(taskRoot, "oracles");
const scoredPath = join(taskRoot, "scored.json");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1];
};
const limit = Number(flag("--limit", "1000"));
const model = flag("--model", "local:malekoo/Qwen3.8-27B-MLX-8bit");
const endpoint = flag("--endpoint", "http://127.0.0.1:8000/v1");
const wallMinutes = Number(flag("--max-wall-minutes", "12"));

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
const wanted = viable.filter((one) => !done.has(`${one.repository}#${one.pull}`)).slice(0, limit);
console.log(`scoring ${wanted.length} mined task(s) against a held-back oracle\n`);

for (const task of wanted) {
  const label = `${task.repository}#${task.pull}`;
  const checkout = join(taskRoot, "work", task.repository.replace("/", "__"));
  const workspace = join(taskRoot, "runs", `${task.repository.replace("/", "__")}-${task.pull}`);

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
  const patchPath = join(workspace, "..", `${task.repository.replace("/", "__")}-${task.pull}.patch`);
  writeFileSync(patchPath, diff.stdout);

  const kind = runnerKind(task.runner);
  const runnerArgv = task.runner.split(" ");
  const judge = async (titles) => {
    const command = oracleCommand({
      storedTestFile: storedTest,
      destination: task.testFile,
      runner: kind,
      runnerArgv,
      titles,
    });
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

  const sealed = await judge(task.sealedCases);
  const heldBack = await judge(task.heldBackCases);
  const corner = classifyAgainstHeldBackOracle({
    verifiedWithFirstOracle: sealed.verified === true,
    heldBackAccepted: heldBack.task === "accepted",
    regression: sealed.regression,
  });

  scored.runs.push({
    repository: task.repository,
    pull: task.pull,
    baseCommit: task.baseCommit,
    agentExit: agent.code,
    regression: sealed.regression,
    sealedOracle: sealed.task,
    heldBackOracle: heldBack.task,
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

const certified = scored.runs.filter((one) => one.verified);
const falseGreens = scored.runs.filter((one) => one.corner === "false-green");
console.log(`\n=== mined corpus, against an oracle the tool was never given ===`);
console.log(`${scored.runs.length} task(s) scored, ${certified.length} certified by the tool`);
if (certified.length > 0) {
  const rate = wilsonInterval(falseGreens.length, certified.length);
  console.log(
    `false greens ${falseGreens.length} of ${certified.length}: ` +
      `${(rate.point * 100).toFixed(1)}% [${(rate.lower * 100).toFixed(1)}, ${(rate.upper * 100).toFixed(1)}]`,
  );
}
console.log(`written: ${scoredPath}`);
