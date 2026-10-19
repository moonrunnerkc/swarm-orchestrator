#!/usr/bin/env node
/**
 * What one Swarm launch did, read from its own chains after it ended, with no model: the planning
 * coverage (admitted, dropped, uncovered and why, reclassified), whether the worker's brief named
 * the uncovered requirements, the reserve it held, whether the final gates and verification ran on
 * the delivered tree, and its wall split by phase as c1-timeline.mjs splits C1's. It verifies each
 * ledger's hash chain and every payload blob first. The hidden oracle's verdict is the runner's,
 * in the record; nothing here judges correctness.
 *
 *   node read-launch.mjs <sessions directory> <run id> [record.json]
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLedgerText, verifyChain } from "../../../../src/evidence/ledger.ts";

const [sessions, runId, recordPath] = process.argv.slice(2);
if (runId === undefined) throw new Error("usage: read-launch.mjs <sessions> <run id> [record.json]");

function load(name) {
  const directory = join(sessions, name);
  const records = parseLedgerText(readFileSync(join(directory, "ledger.jsonl"), "utf8")).records;
  if (!verifyChain(records).ok) throw new Error(`${name}: hash chain does not verify`);
  const blob = (digest) => {
    const bytes = readFileSync(join(directory, "blobs", `${digest.slice(7)}.json`));
    if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== digest)
      throw new Error(`${name}: blob ${digest} differs from its digest`);
    return JSON.parse(bytes.toString());
  };
  for (const record of records) blob(record.payloadDigest);
  return { name, records, blob };
}
const run = load(runId);
const plan = existsSync(join(sessions, `${runId}-plan`)) ? load(`${runId}-plan`) : null;
const payloads = (ledger, type, rule) =>
  ledger.records
    .filter((record) => record.type === type)
    .map((record) => ledger.blob(record.payloadDigest))
    .filter((payload) => rule === undefined || payload.rule === rule);

const planning = payloads(run, "verification-command", "plan-checks-v1")[0] ?? null;
const reconciled = plan === null ? null : (payloads(plan, "verification-command", "planned-coverage-reconciled-v1").at(-1) ?? null);
const admissions = plan === null ? [] : payloads(plan, "verification-command", "planned-check-admission-v3");
const brief = payloads(run, "session-started")[0]?.task ?? "";
const gates = payloads(run, "gate-run");
const lastOf = (id) => gates.filter((one) => one.gateId === id).at(-1) ?? null;
const independent = payloads(run, "independent-verification").at(-1) ?? null;

// Phases, as c1-timeline.mjs counts them.
function phase(ledger, from, to) {
  let modelMs = 0, abortedMs = 0, started = null, toolMs = 0;
  const pending = new Map();
  for (const record of ledger.records) {
    if (record.timestamp < from || record.timestamp > to) continue;
    if (record.type === "model-call-started") started = record.timestamp;
    if (record.type === "model-call") {
      modelMs += record.timestamp - started;
      if (ledger.blob(record.payloadDigest).cancelled === true) abortedMs += record.timestamp - started;
    }
    if (record.type === "tool-call") {
      const payload = ledger.blob(record.payloadDigest);
      if (payload.decision === "requested") pending.set(payload.callId, record.timestamp);
      else toolMs += record.timestamp - pending.get(payload.callId);
    }
  }
  return { wallMs: to - from, modelMs, abortedInFlightMs: abortedMs, toolMs, otherMs: to - from - modelMs - toolMs };
}
const first = (ledger, type) => ledger.records.find((record) => record.type === type);
const loopStart = first(run, "session-started");
const loopStop = run.records.find((record) => record.type === "session-stopped");
// The loop and its repairs end where the last session-stopped record is written; the final
// gate cycle, acceptance and the independent verification follow.
const loopEnd = run.records.filter((record) => record.type === "session-stopped").at(-1).timestamp;
const phases = {
  ...(plan === null ? {} : { planning: phase(plan, plan.records[0].timestamp, plan.records.at(-1).timestamp) }),
  // The run's chain opens before planning; its own work starts where the planning chain ends.
  "seal and preflight": phase(run, plan === null ? run.records[0].timestamp : plan.records.at(-1).timestamp, loopStart.timestamp),
  "worker loop and repairs": phase(run, loopStart.timestamp, loopEnd),
  "final gates, acceptance and verification": phase(run, loopEnd, run.records.at(-1).timestamp),
};

console.log(JSON.stringify({
  runId,
  record: recordPath === undefined ? null : (() => {
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    return { hidden: record.hidden, claimedSuccess: record.invocations?.[0]?.claimedSuccess, exitCode: record.invocations?.[0]?.exitCode, wallMs: record.invocations?.[0]?.wallMs, tokens: record.totals ?? null, finalPatchDigest: record.finalPatchDigest };
  })(),
  planning: planning === null ? null : {
    outcome: planning.outcome,
    durationMs: planning.durationMs,
    tokensUsed: planning.tokensUsed,
    admitted: planning.admission?.admitted,
    dropped: planning.admission?.dropped,
    uncovered: planning.admission?.uncovered,
    revision: planning.admission?.revision,
    coverage: planning.admission?.coverage,
  },
  decisions: admissions.flatMap((one) => one.decisions.map((decision) => ({ check: decision.check, atBase: decision.atBase, finding: decision.finding, reclassified: decision.reclassified, disagreements: decision.disagreements }))),
  reconciled: reconciled?.requirements ?? null,
  briefNamesUncovered: brief.includes("Requirements no generated check covers"),
  reserve: payloads(run, "session-budget", "verification-reserve-v1")[0] ?? null,
  loopStop: loopStop === undefined ? null : run.blob(loopStop.payloadDigest).stopReason,
  repairAttempts: payloads(run, "escalation").at(-1)?.attemptsUsed ?? null,
  finalGates: Object.fromEntries(["build", "lint", "tests", "task-acceptance", "task-diagnostics"].map((id) => [id, lastOf(id) === null ? null : { status: lastOf(id).status, durationMs: lastOf(id).durationMs, detail: String(lastOf(id).detail ?? "").slice(0, 160) }])),
  finalIndependentVerification: independent === null ? null : { refusal: independent.refusal ?? null, regression: independent.regression ?? null, appliedPatchDigest: independent.appliedPatchDigest ?? null },
  assessment: payloads(run, "run-assessment").at(-1)?.inputs ?? null,
  phases,
}, null, 2));
