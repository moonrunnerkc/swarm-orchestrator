import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const directory = process.argv[2];
const records = readFileSync(join(directory, "ledger.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
const payload = record => {
  const bytes = readFileSync(join(directory, "blobs", `${record.payloadDigest.slice(7)}.json`));
  if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== record.payloadDigest) throw new Error("payload digest mismatch");
  return JSON.parse(bytes);
};
const start = records[0].timestamp;
const pending = new Map();
const seen = new Set();
const readLines = new Map();
let repeatedReadLines = 0;
let toolMs = 0, repeated = 0, firstEdit = null, modelMs = 0, unknownModelTimes = 0;
const edits = [], candidates = [], verification = [], verificationIntervals = [];
let gateCommandMs = 0;
for (const record of records) {
  const p = payload(record);
  if (record.type === "model-call") {
    if (p.performance?.responseTimeMs == null) unknownModelTimes++;
    else modelMs += p.performance.responseTimeMs;
  }
  if (record.type === "gate-run" && Number.isFinite(p.durationMs) && p.durationMs > 0) {
    gateCommandMs += p.durationMs;
    verificationIntervals.push([record.timestamp - p.durationMs, record.timestamp]);
  }
  if (record.type === "independent-verification") {
    candidates.push({sequence: record.sequence, patch: p.appliedPatchDigest ?? null, regression: p.regression, task: p.task});
    const install = records.filter(r => r.sequence < record.sequence && r.type === "dependency-install").at(-1);
    verification.push({sequence: record.sequence, ms: install ? record.timestamp - install.timestamp : null});
    if (install) verificationIntervals.push([install.timestamp, record.timestamp]);
  }
  if (record.type !== "tool-call") continue;
  if (p.decision === "requested") { pending.set(p.callId, record.timestamp); continue; }
  const opened = pending.get(p.callId);
  if (opened !== undefined) { toolMs += record.timestamp - opened; pending.delete(p.callId); }
  const editsFile = p.decision === "allowed" && ["write", "edit"].includes(p.toolName) && /^(wrote|replaced|created)/.test(p.output);
  if (editsFile) {
    firstEdit ??= record.timestamp - start;
    edits.push({sequence: record.sequence, ms: record.timestamp - start, path: p.input.path});
    seen.clear(); readLines.clear();
  }
  if (p.toolName === "read" && p.decision === "allowed" && Number.isInteger(p.facts?.firstLine) && Number.isInteger(p.facts?.lastLine)) {
    const lines = readLines.get(p.input.path) ?? new Set();
    for (let line = p.facts.firstLine; line <= p.facts.lastLine; line++) {
      if (lines.has(line)) repeatedReadLines++;
      lines.add(line);
    }
    readLines.set(p.input.path, lines);
  }
  const key = JSON.stringify([p.toolName, p.input, p.decision, p.output]);
  if (seen.has(key)) repeated++;
  seen.add(key);
  if (p.toolName === "shell" && p.decision === "allowed") { seen.clear(); readLines.clear(); }
}
let verificationUnionMs = 0, until = -Infinity;
for (const [from, to] of verificationIntervals.sort((a, b) => a[0] - b[0])) {
  verificationUnionMs += Math.max(0, to - Math.max(from, until));
  until = Math.max(until, to);
}
console.log(JSON.stringify({session: directory.split("/").at(-1), wallMs: records.at(-1).timestamp - start,
  modelMs, unknownModelTimes, toolMs, unmatchedToolIntents: pending.size, repeatedExactObservations: repeated, repeatedReadLines,
  firstEditMs: firstEdit, edits, candidates, verification, gateCommandMs, verificationUnionMs,
  limitations: "tool intervals include run_check verification, so categories overlap; independent verification intervals use the prior install record as in the published accountant; verificationUnionMs unions those intervals with gate duration intervals ending at each gate record and is an estimate, not CPU time; shell effects conservatively invalidate repeat tracking; no timing category establishes causation"
}, null, 2));
