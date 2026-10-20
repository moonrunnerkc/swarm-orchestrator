#!/usr/bin/env node
/**
 * C1's wall, split into phases from its own ledgers, with no model and no double counting.
 *
 *   node scripts/evidence-pack.mjs restore docs/evidence/2026-10-19/repair-value/packed-derived/launch-streams
 *   node docs/evidence/2026-10-19/coverage-and-reserve/c1-timeline.mjs <restored>/comparison/sessions
 *
 * It first verifies what it reads: each ledger's hash chain, and every payload blob against the
 * digest its record carries. Then, per phase: model time is each call's model-call-started record
 * to its model-call record (a call cut off in flight included, and named); tool time is each tool
 * call's requested record to its settling record; the rest is the harness's own work between them.
 * Nested durations are not added: a gate or check run inside a tool call counts once, as tool time.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseLedgerText, verifyChain } from "../../../../src/evidence/ledger.ts";

const directory = process.argv[2];
if (directory === undefined) throw new Error("usage: c1-timeline.mjs <restored comparison/sessions>");
const planName = "20261019T155523-5be681-plan";
const runName = "20261019T155523-5be681";

function load(name) {
  const records = parseLedgerText(readFileSync(`${directory}/${name}.ledger.jsonl`, "utf8")).records;
  const chain = verifyChain(records);
  if (!chain.ok) throw new Error(`${name}: hash chain does not verify`);
  for (const record of records) {
    const bytes = readFileSync(`${directory}/${name}.blobs/${record.payloadDigest.slice(7)}.json`);
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (digest !== record.payloadDigest) throw new Error(`${name} #${record.sequence}: blob digest differs`);
  }
  return { name, records, head: chain.head };
}
const blob = (ledger, digest) =>
  JSON.parse(readFileSync(`${directory}/${ledger.name}.blobs/${digest.slice(7)}.json`, "utf8"));
const at = (ledger, sequence) => ledger.records.find((one) => one.sequence === sequence).timestamp;

function phase(ledger, from, to) {
  let modelMs = 0, abortedMs = 0, calls = 0, inputTokens = 0, outputTokens = 0, started = null;
  const pending = new Map();
  const tools = {};
  for (const record of ledger.records) {
    if (record.timestamp < from || record.timestamp > to) continue;
    if (record.type === "model-call-started") started = record.timestamp;
    if (record.type === "model-call") {
      const payload = blob(ledger, record.payloadDigest);
      calls += 1;
      modelMs += record.timestamp - started;
      if (payload.cancelled === true) abortedMs += record.timestamp - started;
      inputTokens += payload.inputTokens ?? 0;
      outputTokens += payload.outputTokens ?? 0;
    }
    if (record.type === "tool-call") {
      const payload = blob(ledger, record.payloadDigest);
      if (payload.decision === "requested") pending.set(payload.callId, record.timestamp);
      else {
        const name = payload.toolName === "shell" ? `shell: ${payload.input.command}` : payload.toolName;
        tools[name] = (tools[name] ?? 0) + record.timestamp - pending.get(payload.callId);
      }
    }
  }
  const toolMs = Object.values(tools).reduce((sum, one) => sum + one, 0);
  return { wallMs: to - from, modelMs, abortedInFlightMs: abortedMs, modelCalls: calls, inputTokens, outputTokens, toolMs, otherMs: to - from - modelMs - toolMs, tools };
}

const plan = load(planName);
const run = load(runName);
const t0 = plan.records[0].timestamp;
const phases = {
  "planning, round 1 (planner session 1, its in-loop base run of the planned checks included)": phase(plan, t0, at(plan, 203)),
  "planning, revision (planner session 2)": phase(plan, at(plan, 204), at(plan, 322)),
  "contract seal and preflight of the sealed checks at the base": phase(run, at(run, 2), at(run, 13)),
  "worker loop": phase(run, at(run, 14), at(run, 315)),
  "final phase (build, lint and tests refused; acceptance gate, bonds, final independent verification)": phase(run, at(run, 316), at(run, 358)),
};

// Every worker model call: its prompt's message count, input tokens and time to the first token,
// and whether the 113 KB `npm test` output (call_dvr6ym76) was among the messages resent.
const calls = [];
let window = [];
for (const record of run.records) {
  if (record.type === "transcript-component") {
    const value = blob(run, record.payloadDigest).value;
    if (value?.role === "user" && /^\[\d+ messages compacted/.test(value.text ?? "")) window = [value.text.match(/^\[(\d+)/)[1]];
    else if (value?.outcomes?.some((one) => one.callId === "call_dvr6ym76")) window.push("npm-test-output");
  }
  if (record.type === "model-call-started") {
    const payload = blob(run, record.payloadDigest);
    calls.push({ step: payload.step, messages: payload.prompt.length, compactedMarker: window[0] ?? null, carriesNpmTestOutput: window.includes("npm-test-output") });
    window = [];
  }
  if (record.type === "model-call") {
    const payload = blob(run, record.payloadDigest);
    Object.assign(calls.at(-1), { inputTokens: payload.inputTokens, firstTokenMs: Math.round(payload.performance?.firstTokenMs ?? -1), responseMs: Math.round(payload.performance?.responseTimeMs ?? -1) });
  }
}
const carrying = calls.filter((one) => one.carriesNpmTestOutput);
console.log(JSON.stringify({
  verified: { [planName]: plan.head, [runName]: run.head },
  totalMs: run.records.at(-1).timestamp - t0,
  phases,
  workerCalls: calls,
  carryingTheOutput: { calls: carrying.length, responseMs: carrying.reduce((sum, one) => sum + one.responseMs, 0), inputTokens: carrying.map((one) => one.inputTokens) },
}, null, 2));
