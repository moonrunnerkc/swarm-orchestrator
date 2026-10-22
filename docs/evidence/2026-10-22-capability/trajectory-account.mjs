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
let toolMs = 0, repeated = 0, firstEdit = null, modelMs = 0, unknownModelTimes = 0;
const edits = [], candidates = [], verification = [];
for (const record of records) {
  const p = payload(record);
  if (record.type === "model-call") {
    if (p.performance?.responseTimeMs == null) unknownModelTimes++;
    else modelMs += p.performance.responseTimeMs;
  }
  if (record.type === "independent-verification") {
    candidates.push({sequence: record.sequence, patch: p.appliedPatchDigest ?? null, regression: p.regression, task: p.task});
    const install = records.filter(r => r.sequence < record.sequence && r.type === "dependency-install").at(-1);
    verification.push({sequence: record.sequence, ms: install ? record.timestamp - install.timestamp : null});
  }
  if (record.type !== "tool-call") continue;
  if (p.decision === "requested") { pending.set(p.callId, record.timestamp); continue; }
  const opened = pending.get(p.callId);
  if (opened !== undefined) { toolMs += record.timestamp - opened; pending.delete(p.callId); }
  const editsFile = p.decision === "allowed" && ["write", "edit"].includes(p.toolName) && /^(wrote|replaced|created)/.test(p.output);
  if (editsFile) {
    firstEdit ??= record.timestamp - start;
    edits.push({sequence: record.sequence, ms: record.timestamp - start, path: p.input.path});
    seen.clear();
  }
  const key = JSON.stringify([p.toolName, p.input, p.decision, p.output]);
  if (seen.has(key)) repeated++;
  seen.add(key);
  if (p.toolName === "shell" && p.decision === "allowed") seen.clear();
}
console.log(JSON.stringify({session: directory.split("/").at(-1), wallMs: records.at(-1).timestamp - start,
  modelMs, unknownModelTimes, toolMs, unmatchedToolIntents: pending.size, repeatedExactObservations: repeated,
  firstEditMs: firstEdit, edits, candidates, verification,
  limitations: "tool intervals include run_check verification, so categories overlap; verification intervals use the prior install record as in the published accountant; shell effects conservatively invalidate repeat tracking; no timing category establishes causation"
}, null, 2));
