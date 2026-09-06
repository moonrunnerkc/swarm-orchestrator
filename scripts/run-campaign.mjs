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
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  campaignPlan,
  classifyAgainstOracle,
  judgeByHiddenOracle,
  seedWorkspace,
} from "../dist/eval/campaign-run.js";
import { scoreArms } from "../dist/eval/arms.js";
import { mcNemar, wilsonInterval } from "../dist/eval/statistics.js";

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

/** The gate strip out of the harness's own report: one row per gate, as it printed them. */
function gatesFrom(output) {
  const gates = [];
  for (const line of String(output).split("\n")) {
    const read = /^ {2}(passed|failed|n\/a) +([a-z0-9:-]+)(?: \(advisory\))?: (.*)$/.exec(line);
    if (read !== null) {
      gates.push({
        id: read[2],
        status: read[1] === "n/a" ? "not-applicable" : read[1],
        detail: String(read[3]).slice(0, 200),
      });
    }
  }
  return gates;
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
 * Which oracle rule judged a record. Bumped whenever the rule changes, so records judged by an
 * older one are re-run rather than silently compared against records judged by this one.
 *
 * 1: restore every test file.
 * 2: do not restore where the gate measures coverage.
 * 3: also do not restore where the gate names a test file and reads it.
 * 4: same judgement as 3, and every record carries the harness's gate strip, so a disagreement
 *    between the harness and the oracle is read off the record rather than reproduced.
 */
const oracleRule = 4;

/** Where a disagreement's tree is kept, so the next one is inspected rather than guessed at. */
const disagreementRoot = flag("keep-disagreements", join(repositoryRoot, "campaign/eval/disagreements"));

/**
 * The arms this architecture can actually separate. Evidence capture is not one of them: the
 * ledger is the core of the system rather than a layer over it, so there is no build of this
 * with it switched off, and pretending otherwise would be an arm that measures nothing.
 */
const arms = [
  { id: "single-minimal", attempts: 0, what: "no auto-resolve: the model's first answer stands" },
  { id: "single-gates", attempts: 3, what: "the gates and the ratchet, retrying up to three times" },
];

const onlyCases = (flag("only", "") ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter((id) => id.length > 0);

const allCases = JSON.parse(
  readFileSync(join(repositoryRoot, "src/select/calibration-cases.v1.json"), "utf8"),
).cases;

// Named cases beat a count, because re-running the two that disagreed is the ordinary follow-up
// and slicing the first N cannot express it.
const cases =
  onlyCases.length > 0
    ? allCases.filter((one) => onlyCases.includes(one.id))
    : allCases.slice(0, caseLimit);

if (onlyCases.length > 0 && cases.length !== onlyCases.length) {
  const missing = onlyCases.filter((id) => !allCases.some((one) => one.id === id));
  console.error(`--only names ${missing.length} case(s) that do not exist: ${missing.join(", ")}`);
  process.exit(2);
}

mkdirSync(join(resultsPath, ".."), { recursive: true });
const done = new Map();
if (existsSync(resultsPath)) {
  for (const line of readFileSync(resultsPath, "utf8").split("\n")) {
    if (line.trim().length === 0) continue;
    const record = JSON.parse(line);
    // A record from before the harness verdict was captured cannot answer the question this
    // campaign exists to answer, so it is re-run rather than counted as done.
    // A record judged before the oracle knew the difference between a case's tests being its
    // specification and being its deliverable cannot answer the question either.
    if (record.corner !== undefined && record.oracleMode !== undefined) {
      done.set(record.idempotencyKey, record);
    }
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
  // What the harness said, gate by gate. Without this a refusal is a bare boolean and the only
  // way to learn why is to reproduce the run, which is how three wrong diagnoses were reached.
  let gateReport = "";
  // What the harness itself concluded. Zero is its `acceptable` verdict; anything else is not.
  // Without this the campaign can say how often a run worked and not how often the tool was
  // wrong about whether it worked, and the second is the number this whole project is about.
  let harnessAcceptable = false;
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
    ).then((ran) => {
      gateReport = ran.stdout ?? "";
      return ran;
    });
    harnessAcceptable = true;
  } catch (cause) {
    // Counted, never dropped: a run that failed to complete produced no accepted patch, and
    // removing it turns the arm's rate into the rate of the runs that happened to work.
    //
    // A non-zero exit is a run that ran and did not end acceptable, which is a result. A kill,
    // a signal, or a refusal before anything started is a run that did not happen, which is a
    // crash. Folding the two would hide an arm that never launched behind an arm that failed.
    const exitedCleanly = typeof cause.code === "number" && cause.killed !== true;
    completed = exitedCleanly && latencyGuard(startedAt);
    gateReport = cause.stdout ?? "";
    detail = (cause.stderr ?? cause.message ?? "").split("\n").slice(-2).join(" ").slice(0, 300);
  }
  const latencyMs = Date.now() - startedAt;

  const judged = await judgeByHiddenOracle(workspace, one);
  // The four cells, named for the proposition they actually compare. The harness ran without an
  // oracle, so its verdict carries `task: unjudged` and its acceptance is a claim about the
  // configured gates. Comparing that to a task oracle measures gate adequacy, never tool honesty.
  const corner = classifyAgainstOracle({ harnessAcceptable, oracleAccepted: judged.accepted });
  const record = {
    ...planned,
    accepted: judged.accepted,
    oracleMode: judged.mode,
    oracleRule,
    // Every gate the harness ran and what it concluded, so a disagreement with the oracle is
    // read off the record rather than guessed at or reproduced.
    gates: gatesFrom(gateReport),
    blockingFailures: gatesFrom(gateReport)
      .filter((gate) => gate.status === "failed")
      .map((gate) => gate.id),
    harnessAcceptable,
    corner,
    completed,
    costUsd: 0,
    latencyMs,
    detail: judged.detail || detail,
    model,
    at: new Date().toISOString(),
  };
  appendFileSync(resultsPath, `${JSON.stringify(record)}\n`);
  finished.push(record);

  // A run where the harness and the oracle disagree is the only kind worth looking at, and
  // looking at it needs the tree. Deleting every workspace meant each disagreement had to be
  // re-derived by guesswork, which produced four wrong diagnoses in a row before this was added.
  if (record.corner === "gates-missed" || record.corner === "gates-strict") {
    const kept = join(disagreementRoot, `${record.corner}-${record.caseId}-${record.armId}-${record.seed}`);
    try {
      mkdirSync(disagreementRoot, { recursive: true });
      cpSync(workspace, kept, { recursive: true });
      record.keptWorkspace = kept;
    } catch {
      // Keeping the tree is a convenience for the next person, never a reason to stop the run.
    }
  }
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

console.log("\n=== were the configured gates adequate for the task? ===");
console.log(
  "Not a false-green rate. These runs were given no task oracle, so every harness verdict\n" +
    "reports `task: unjudged` and none of them claims the work was done. What the gap below\n" +
    "measures is how often every configured gate passed over work a hidden oracle refuses.",
);
for (const arm of arms) {
  const mine = finished.filter((entry) => entry.armId === arm.id && entry.corner !== undefined);
  if (mine.length === 0) {
    console.log(`${arm.id.padEnd(16)} no run recorded a harness verdict`);
    continue;
  }
  const count = (name) => mine.filter((entry) => entry.corner === name).length;
  const missed = count("gates-missed");
  const rate = wilsonInterval(missed, mine.length);
  console.log(
    `${arm.id.padEnd(16)} ${mine.length} judged: ` +
      `${count("agree-accept")} agree accept, ${missed} GATES MISSED, ` +
      `${count("gates-strict")} gates stricter, ${count("agree-refuse")} agree refuse`,
  );
  console.log(
    `${"".padEnd(16)} gates-missed rate ${(rate.point * 100).toFixed(1)}% ` +
      `[${(rate.lower * 100).toFixed(1)}, ${(rate.upper * 100).toFixed(1)}]`,
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
  `${JSON.stringify(
    {
      model,
      endpoint,
      seeds,
      cases: cases.length,
      scores,
      mcNemar: judged,
      onlyFirst,
      onlySecond,
      corners: Object.fromEntries(
        arms.map((arm) => {
          const mine = finished.filter((e) => e.armId === arm.id && e.corner !== undefined);
          const count = (name) => mine.filter((e) => e.corner === name).length;
          return [
            arm.id,
            {
              judged: mine.length,
              agreeAccept: count("agree-accept"),
              gatesMissed: count("gates-missed"),
              gatesStrict: count("gates-strict"),
              agreeRefuse: count("agree-refuse"),
              gatesMissedRate: wilsonInterval(count("gates-missed"), mine.length),
            },
          ];
        }),
      ),
    },
    null,
    2,
  )}\n`,
);
console.log(`\nrecords: ${resultsPath}`);
