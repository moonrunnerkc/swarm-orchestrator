#!/usr/bin/env node
/**
 * Runs one task on one real repository through one arm, scores the tree it leaves with the
 * harness alone, and appends one record. Everything a run could be shaped by, the task text
 * and the hidden acceptance test, is read from docs/evidence/<date>/real-repos, which was
 * committed before the first run.
 *
 *   node scripts/real-repos.mjs run --repo <name> --arm <swarm|baseline> --run <n> [--date <YYYY-MM-DD>]
 *   node scripts/real-repos.mjs report [--date <YYYY-MM-DD>]
 *
 * The swarm arm is this tree's CLI, built into dist/, against the local Ollama backend. The
 * baseline arm is Claude Code headless against the same backend and the same model, given the
 * identical task text in a fresh clone. Both arms are scored by `swarm gates` over the tree
 * they left, with no model involved, and by the hidden test the task names.
 */
import { spawn } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { distribution } from "./compare-calibrations.mjs";

const root = resolve(import.meta.dirname, "..");
const localBackend = "http://127.0.0.1:11434";
const model = "qwen3.6:35b-a3b";

export const repositories = Object.freeze({
  "ts-pattern": {
    fullName: "gvergnaud/ts-pattern",
    hidden: {
      file: "ts-pattern/hidden/object-empty.hidden.test.ts",
      destination: "tests/object-empty.hidden.test.ts",
      argv: ["npx", "jest", "tests/object-empty.hidden.test.ts"],
    },
  },
  purify: {
    fullName: "gigobyte/purify",
    hidden: {
      file: "purify/hidden/List.partition.hidden.test.ts",
      destination: "src/List.partition.hidden.test.ts",
      argv: ["npx", "vitest", "run", "src/List.partition.hidden.test.ts"],
    },
  },
  darkreader: {
    fullName: "darkreader/darkreader",
    hidden: {
      file: "darkreader/hidden/array-chunk.hidden.tests.ts",
      destination: "tests/unit/utils/array-chunk.hidden.tests.ts",
      argv: ["npx", "jest", "--config=tests/unit/jest.config.mjs", "tests/unit/utils/array-chunk.hidden.tests.ts"],
    },
  },
});

export const arms = Object.freeze(["swarm", "baseline"]);

/** The paragraph both arms are given, taken from task.md so the two cannot drift apart. */
export function taskText(markdown) {
  const heading = "## The task text both arms are given, verbatim";
  const start = markdown.indexOf(heading);
  if (start === -1) throw new Error(`task.md carries no "${heading}" section`);
  const body = markdown.slice(start + heading.length);
  const end = body.indexOf("\n## ");
  return (end === -1 ? body : body.slice(0, end)).trim().replace(/\s*\n\s*/g, " ");
}

/** The pinned commit, from the campaign's sealed selection rather than a second copy of it. */
export function pinnedCommit(fullName, selection) {
  const entry = selection.find((repository) => repository.fullName === fullName);
  if (entry === undefined) throw new Error(`${fullName} is not in the campaign selection`);
  return entry.commit;
}

function readLedger(directory) {
  const ledger = readFileSync(join(directory, "ledger.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
  return ledger.map((record) => ({
    ...record,
    payload: JSON.parse(readFileSync(join(directory, "blobs", `${record.payloadDigest.replace("sha256:", "")}.json`), "utf8")),
  }));
}

/**
 * What the harness measured over the produced tree: every gate's status in the last cycle, and
 * the base comparison's measures, read from the gates bundle and nothing else.
 */
export function scoreFromRecords(records) {
  const gateRuns = records.filter((record) => record.type === "gate-run");
  const lastAttempt = gateRuns.length === 0 ? 0 : Math.max(...gateRuns.map((record) => record.payload.attempt ?? 0));
  const gates = {};
  for (const record of gateRuns) {
    if ((record.payload.attempt ?? 0) === lastAttempt) gates[record.payload.gateId] = record.payload.status;
  }
  const base = records.find((record) => record.type === "ratchet-decision" && record.payload.scope === "base");
  const measures = base === undefined ? null : base.payload.measures.after;
  const blockingFailures = gateRuns
    .filter((record) => (record.payload.attempt ?? 0) === lastAttempt && record.payload.blocking && record.payload.status === "failed")
    .map((record) => record.payload.gateId);
  const commandGateRan = gateRuns.some(
    (record) => (record.payload.attempt ?? 0) === lastAttempt && record.payload.command !== null && record.payload.status !== "not-applicable",
  );
  return { gates, measures, blockingFailures, green: blockingFailures.length === 0 && commandGateRan };
}

/** Tokens the swarm arm spent, summed over its model-call records. */
export function tokensFromRecords(records) {
  let input = 0;
  let output = 0;
  let calls = 0;
  for (const record of records) {
    if (record.type !== "model-call") continue;
    calls += 1;
    input += record.payload.inputTokens ?? 0;
    output += record.payload.outputTokens ?? 0;
  }
  return { calls, input, output };
}

function run(command, args, options) {
  return new Promise((settle) => {
    const startedAt = Date.now();
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => settle({ code, stdout, stderr, wallMs: Date.now() - startedAt }));
  });
}

async function git(cwd, ...args) {
  const done = await run("git", args, { cwd });
  if (done.code !== 0) throw new Error(`git ${args.join(" ")} in ${cwd}: ${done.stderr.trim()}`);
  return done.stdout;
}

/**
 * A fresh clone at the pinned commit with its dependencies installed from the lockfile. Not
 * copied from the campaign's prepared clone: those were installed inside a linux container,
 * and the first jest run on this machine spent its time fetching the darwin binding it lacked
 * and exited 1 while it did, which scored a passing suite as a failing gate.
 */
async function prepareWorkspace(source, commit, destination) {
  rmSync(destination, { recursive: true, force: true });
  await git(root, "clone", "--quiet", source, destination);
  await git(destination, "checkout", "--quiet", commit);
  const installed = await run("npm", ["ci", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: destination });
  if (installed.code !== 0) throw new Error(`npm ci in ${destination} exited ${installed.code}: ${installed.stderr.slice(-800)}`);
}

/** The whole tree against the pinned commit, untracked files included, without moving the index for good. */
async function captureDiff(workspace, commit) {
  await git(workspace, "add", "-A");
  const patch = await git(workspace, "diff", "--cached", commit);
  await git(workspace, "reset", "--quiet");
  return patch;
}

function swarmEnvironment() {
  return { ...process.env, SWARM_LOCAL_BASE_URL: `${localBackend}/v1` };
}

function baselineEnvironment() {
  return {
    ...process.env,
    ANTHROPIC_BASE_URL: localBackend,
    ANTHROPIC_AUTH_TOKEN: "ollama",
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_MODEL: model,
    ANTHROPIC_SMALL_FAST_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    CLAUDE_CODE_MAX_CONTEXT_TOKENS: "131072",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
}

async function runArm(arm, workspace, commit, task, runDirectory) {
  if (arm === "swarm") {
    const bundle = join(runDirectory, "bundle");
    const done = await run(
      "node",
      [join(root, "dist/cli.js"), "--no-tui", "--no-color", "--workspace", workspace, "--base", commit, "--model", `local:${model}`, "--bundle", bundle, "--max-wall-minutes", "30", task],
      { cwd: root, env: swarmEnvironment() },
    );
    const records = existsSync(join(bundle, "ledger.jsonl")) ? readLedger(bundle) : [];
    const stopped = records.find((record) => record.type === "session-stopped");
    return {
      exitCode: done.code,
      wallMs: done.wallMs,
      transcript: `${done.stdout}\n${done.stderr}`,
      tokens: tokensFromRecords(records),
      stopReason: stopped?.payload.stopReason ?? null,
      escalated: records.some((record) => record.type === "escalation"),
      bundleRecords: records.length,
    };
  }
  const done = await run(
    "claude",
    ["-p", task, "--model", model, "--permission-mode", "bypassPermissions", "--dangerously-skip-permissions", "--output-format", "json", "--max-turns", "80"],
    { cwd: workspace, env: baselineEnvironment() },
  );
  let parsed = null;
  try {
    parsed = JSON.parse(done.stdout);
  } catch {
    parsed = null;
  }
  return {
    exitCode: done.code,
    wallMs: done.wallMs,
    transcript: `${done.stdout}\n${done.stderr}`,
    tokens: parsed === null ? null : { calls: parsed.num_turns ?? null, input: (parsed.usage?.input_tokens ?? 0) + (parsed.usage?.cache_creation_input_tokens ?? 0) + (parsed.usage?.cache_read_input_tokens ?? 0), output: parsed.usage?.output_tokens ?? 0 },
    stopReason: parsed?.stop_reason ?? parsed?.terminal_reason ?? null,
    escalated: null,
    bundleRecords: null,
  };
}

async function hiddenTest(workspace, hidden, evidenceRoot) {
  const destination = join(workspace, hidden.destination);
  mkdirSync(resolve(destination, ".."), { recursive: true });
  cpSync(join(evidenceRoot, hidden.file), destination);
  try {
    const done = await run(hidden.argv[0], hidden.argv.slice(1), { cwd: workspace });
    return { passed: done.code === 0, exitCode: done.code, output: `${done.stdout}\n${done.stderr}`.slice(-4000) };
  } finally {
    rmSync(destination, { force: true });
  }
}

async function runOne(options) {
  const repository = repositories[options.repo];
  if (repository === undefined) throw new Error(`no such repository: ${options.repo}. One of ${Object.keys(repositories).join(", ")}`);
  if (!arms.includes(options.arm)) throw new Error(`no such arm: ${options.arm}. One of ${arms.join(", ")}`);
  const evidenceRoot = join(root, "docs/evidence", options.date, "real-repos");
  const selection = JSON.parse(readFileSync(join(root, "campaign/selection/repos.json"), "utf8"));
  const commit = pinnedCommit(repository.fullName, selection);
  const task = taskText(readFileSync(join(evidenceRoot, options.repo, "task.md"), "utf8"));
  const source = join(root, "campaign/work", repository.fullName.replace("/", "__"));
  const runDirectory = join(evidenceRoot, options.repo, options.arm, `run-${options.run}`);
  if (existsSync(join(runDirectory, "run.json"))) throw new Error(`${runDirectory} already holds a run; a run is never overwritten`);
  const workspace = join(options.scratch, `${options.repo}-${options.arm}-${options.run}`);
  mkdirSync(runDirectory, { recursive: true });

  await prepareWorkspace(source, commit, workspace);
  const startedAt = new Date().toISOString();
  const armResult = await runArm(options.arm, workspace, commit, task, runDirectory);
  writeFileSync(join(runDirectory, "transcript.txt"), armResult.transcript);
  writeFileSync(join(runDirectory, "diff.patch"), await captureDiff(workspace, commit));

  const scoreDirectory = join(runDirectory, "score");
  const scored = await run("node", [join(root, "dist/cli.js"), "gates", "--workspace", workspace, "--base", commit, "--bundle", scoreDirectory], { cwd: root });
  const score = existsSync(join(scoreDirectory, "ledger.jsonl")) ? scoreFromRecords(readLedger(scoreDirectory)) : null;
  const hidden = await hiddenTest(workspace, repository.hidden, evidenceRoot);
  for (const directory of ["bundle", "score"]) rmSync(join(runDirectory, directory, "review.html"), { force: true });

  const record = {
    repository: repository.fullName,
    name: options.repo,
    commit,
    arm: options.arm,
    run: options.run,
    model,
    backend: localBackend,
    startedAt,
    wallMs: armResult.wallMs,
    exitCode: armResult.exitCode,
    stopReason: armResult.stopReason,
    escalated: armResult.escalated,
    bundleRecords: armResult.bundleRecords,
    tokens: armResult.tokens,
    scoreExitCode: scored.code,
    score,
    hiddenTest: { passed: hidden.passed, exitCode: hidden.exitCode },
    diffBytes: readFileSync(join(runDirectory, "diff.patch")).length,
  };
  writeFileSync(join(runDirectory, "run.json"), `${JSON.stringify(record, null, 2)}\n`);
  writeFileSync(join(runDirectory, "hidden-test.txt"), hidden.output);
  appendFileSync(join(evidenceRoot, "runs.jsonl"), `${JSON.stringify(record)}\n`);
  process.stdout.write(`${options.repo} ${options.arm} run ${options.run}: exit ${armResult.exitCode}, ${Math.round(armResult.wallMs / 1000)}s, gates ${score === null ? "unscored" : score.green ? "green" : `not green (${score.blockingFailures.join(", ") || "nothing ran"})`}, hidden test ${hidden.passed ? "passed" : "failed"}\n`);
  return record;
}

function format(value, digits) {
  return value === null ? "n/a" : Number(value).toFixed(digits);
}

/** Per repository and arm, distributions over the runs, read from the records alone. */
export function renderReport(records, date) {
  const lines = [`# Real repositories: ${records.some((r) => r.arm === "baseline") ? "two arms" : "single arm"}, ${date}`, ""];
  lines.push(`Generated from \`runs.jsonl\` beside this file. Every number is over the runs recorded there.`, "");
  const names = [...new Set(records.map((record) => record.name))].sort();
  for (const name of names) {
    lines.push(`## ${name}`, "");
    lines.push("| arm | runs | gates green | hidden test passed | tests declared | assertions | skip markers | tests collected | changed-line coverage | wall time (s) | output tokens |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const arm of arms) {
      const mine = records.filter((record) => record.name === name && record.arm === arm);
      if (mine.length === 0) {
        lines.push(`| ${arm} | 0 | NOT-DONE | | | | | | | | |`);
        continue;
      }
      const measure = (key) => mine.map((record) => record.score?.measures?.[key] ?? null);
      const spread = (values, digits) => {
        const d = distribution(values);
        return d.count === 0 ? "not measured" : `${format(d.minimum, digits)} / ${format(d.median, digits)} / ${format(d.maximum, digits)}${d.count < mine.length ? ` (${d.count} of ${mine.length})` : ""}`;
      };
      lines.push(
        `| ${arm} | ${mine.length} | ${mine.filter((record) => record.score?.green === true).length} of ${mine.length} | ${mine.filter((record) => record.hiddenTest.passed).length} of ${mine.length} | ${spread(measure("testsDeclared"), 0)} | ${spread(measure("assertions"), 0)} | ${spread(measure("skipMarkers"), 0)} | ${spread(measure("testsCollected"), 0)} | ${spread(measure("changedLineCoverage"), 3)} | ${spread(mine.map((record) => record.wallMs / 1000), 0)} | ${spread(mine.map((record) => record.tokens?.output ?? null), 0)} |`,
      );
    }
    lines.push("", "Distributions are min / median / max over the runs; a measure fewer runs carried says how many.", "");
  }
  return lines.join("\n");
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let index = 0; index < rest.length; index += 2) flags[rest[index].replace(/^--/, "")] = rest[index + 1];
  return { command, flags };
}

if (import.meta.filename === process.argv[1]) {
  const { command, flags } = parseArguments(process.argv.slice(2));
  const date = flags.date ?? "2026-09-04";
  if (command === "run") {
    if (flags.repo === undefined || flags.arm === undefined || flags.run === undefined) {
      console.error("usage: node scripts/real-repos.mjs run --repo <name> --arm <swarm|baseline> --run <n> [--date <YYYY-MM-DD>]");
      process.exit(2);
    }
    const scratch = flags.scratch ?? join(root, ".swarm", "real-repos");
    mkdirSync(scratch, { recursive: true });
    await runOne({ repo: flags.repo, arm: flags.arm, run: Number(flags.run), date, scratch });
  } else if (command === "report") {
    const evidenceRoot = join(root, "docs/evidence", date, "real-repos");
    const records = readFileSync(join(evidenceRoot, "runs.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const report = renderReport(records, date);
    writeFileSync(join(evidenceRoot, "report.md"), `${report}\n`);
    process.stdout.write(report);
  } else {
    console.error("usage: node scripts/real-repos.mjs run|report ...");
    process.exit(2);
  }
}
