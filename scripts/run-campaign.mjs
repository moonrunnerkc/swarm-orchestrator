#!/usr/bin/env node
// Drives the campaign arms across the golden set against a local model.
//
// The arms differ in the harness they run under, not in the model, so a local backend answers
// the question the design actually asks: does each layer earn its complexity. What a local-only
// campaign cannot answer is whether the same holds at frontier capability, and that limit is
// stated in the report rather than left to be assumed.
//
// Acceptance is decided by the hidden oracle rather than by the run's own gate. The golden set
// ships its test inside the case seed, so an arm with no ratchet can pass its gate by deleting
// the test; the oracle restores the original test over whatever the run left and asks again.
import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  campaignPlan,
  judgeByHiddenOracle,
  seedWorkspace,
} from "../dist/eval/campaign-run.js";
import { scoreArms } from "../dist/eval/arms.js";
import { mcNemar } from "../dist/eval/statistics.js";

const run = promisify(execFile);
const repositoryRoot = new URL("..", import.meta.url).pathname;

/**
 * A run that came back faster than the model could possibly have answered did not run. The
 * campaign's first pass recorded four such runs as completed-and-refused, which reads as an arm
 * that tried and failed rather than an arm that never started.
 */
function latencyGuard(startedAt) {
  return Date.now() - startedAt >= 2_000;
}

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const model = flag("model", "local:malekoo/Qwen3.8-27B-MLX-8bit");
const endpoint = flag("endpoint", "http://127.0.0.1:8000/v1");
const seeds = Number(flag("seeds", "3"));
const caseLimit = Number(flag("cases", "20"));
const wallMinutes = Number(flag("wall-minutes", "6"));
const resultsPath = flag("out", join(repositoryRoot, "campaign/eval/runs.jsonl"));

/**
 * The arms this architecture can actually separate. Evidence capture is not one of them: the
 * ledger is the core of the system rather than a layer over it, so there is no build of this
 * with it switched off, and pretending otherwise would be an arm that measures nothing.
 */
const arms = [
  { id: "single-minimal", attempts: 0, what: "no auto-resolve: the model's first answer stands" },
  { id: "single-gates", attempts: 3, what: "the gates and the ratchet, retrying up to three times" },
];

const cases = JSON.parse(
  readFileSync(join(repositoryRoot, "src/select/calibration-cases.v1.json"), "utf8"),
).cases.slice(0, caseLimit);

mkdirSync(join(resultsPath, ".."), { recursive: true });
const done = new Map();
if (existsSync(resultsPath)) {
  for (const line of readFileSync(resultsPath, "utf8").split("\n")) {
    if (line.trim().length === 0) continue;
    const record = JSON.parse(line);
    done.set(record.idempotencyKey, record);
  }
  console.log(`resuming: ${done.size} run(s) already recorded`);
}

const plan = campaignPlan({ arms: arms.map((arm) => arm.id), cases, seeds });
console.log(
  `${plan.total} runs: ${arms.length} arm(s) x ${cases.length} case(s) x ${seeds} seed(s)\n` +
    `model ${model} at ${endpoint}\n`,
);

const scratchRoot = mkdtempSync(join(tmpdir(), "swarm-campaign-"));
const finished = [];
let index = 0;

for (const planned of plan.runs) {
  index += 1;
  const already = done.get(planned.idempotencyKey);
  if (already !== undefined) {
    finished.push(already);
    continue;
  }

  const one = cases.find((entry) => entry.id === planned.caseId);
  const arm = arms.find((entry) => entry.id === planned.armId);
  const workspace = await seedWorkspace(scratchRoot, one);

  // A repository, because the gates measure a change against a base commit.
  await run("git", ["init", "-q"], { cwd: workspace });
  writeFileSync(
    join(workspace, "swarm.toml"),
    `[providers]\nlocal_endpoint = "${endpoint}"\nlocal_thinking = false\n`,
  );
  await run("git", ["add", "-A"], { cwd: workspace });
  await run(
    "git",
    ["-c", "user.email=c@i", "-c", "user.name=campaign", "commit", "-qm", "base"],
    { cwd: workspace },
  );

  const startedAt = Date.now();
  let completed = true;
  let detail = "";
  try {
    await run(
      process.execPath,
      [
        join(repositoryRoot, "dist/cli.js"),
        "--model",
        model,
        "--local-endpoint",
        endpoint,
        "--no-tui",
        "--attempts",
        String(arm.attempts),
        "--max-wall-minutes",
        String(wallMinutes),
        one.prompt,
      ],
      { cwd: workspace, timeout: (wallMinutes + 3) * 60_000, maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (cause) {
    // Counted, never dropped: a run that failed to complete produced no accepted patch, and
    // removing it turns the arm's rate into the rate of the runs that happened to work.
    //
    // A non-zero exit is a run that ran and did not end acceptable, which is a result. A kill,
    // a signal, or a refusal before anything started is a run that did not happen, which is a
    // crash. Folding the two would hide an arm that never launched behind an arm that failed.
    const exitedCleanly = typeof cause.code === "number" && cause.killed !== true;
    completed = exitedCleanly && latencyGuard(startedAt);
    detail = (cause.stderr ?? cause.message ?? "").split("\n").slice(-2).join(" ").slice(0, 300);
  }
  const latencyMs = Date.now() - startedAt;

  const judged = await judgeByHiddenOracle(workspace, one);
  const record = {
    ...planned,
    accepted: judged.accepted,
    completed,
    costUsd: 0,
    latencyMs,
    detail: judged.detail || detail,
    model,
    at: new Date().toISOString(),
  };
  appendFileSync(resultsPath, `${JSON.stringify(record)}\n`);
  finished.push(record);
  rmSync(workspace, { recursive: true, force: true });

  console.log(
    `[${String(index).padStart(3)}/${plan.total}] ${planned.armId.padEnd(15)} ` +
      `${planned.caseId.padEnd(28)} seed ${planned.seed}  ` +
      `${judged.accepted ? "accepted" : "refused "}  ${(latencyMs / 1000).toFixed(0)}s`,
  );
}

rmSync(scratchRoot, { recursive: true, force: true });

const scores = scoreArms(
  arms.map((arm) => ({
    armId: arm.id,
    runs: finished
      .filter((entry) => entry.armId === arm.id)
      .map((entry) => ({
        launched: true,
        completed: entry.completed,
        accepted: entry.accepted,
        costUsd: entry.costUsd,
        latencyMs: entry.latencyMs,
      })),
  })),
);

console.log("\n=== arms ===");
for (const score of scores) {
  const rate = `${(score.accepted.point * 100).toFixed(1)}% [${(score.accepted.lower * 100).toFixed(1)}, ${(score.accepted.upper * 100).toFixed(1)}]`;
  console.log(
    `${score.armId.padEnd(16)} ${score.launched} launched, ${score.crashed} crashed, ` +
      `accepted ${rate}, p50 latency ${Math.round(score.latency.point / 1000)}s`,
  );
}

console.log("\n=== paired comparison ===");
let onlyFirst = 0;
let onlySecond = 0;
for (const pairId of new Set(finished.map((entry) => entry.pairId))) {
  const left = finished.find((e) => e.pairId === pairId && e.armId === arms[0].id);
  const right = finished.find((e) => e.pairId === pairId && e.armId === arms[1].id);
  if (left === undefined || right === undefined || left.accepted === right.accepted) continue;
  if (left.accepted) onlyFirst += 1;
  else onlySecond += 1;
}
const judged = mcNemar({ onlyFirst, onlySecond });
console.log(
  `${arms[0].id} only: ${onlyFirst}, ${arms[1].id} only: ${onlySecond}, ` +
    `discordant ${judged.discordant}`,
);
console.log(judged.reason);

writeFileSync(
  join(resultsPath, "..", "summary.json"),
  `${JSON.stringify({ model, endpoint, seeds, cases: cases.length, scores, mcNemar: judged, onlyFirst, onlySecond }, null, 2)}\n`,
);
console.log(`\nrecords: ${resultsPath}`);
