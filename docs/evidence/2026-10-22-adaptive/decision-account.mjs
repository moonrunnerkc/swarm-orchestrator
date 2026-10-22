/**
 * The decision point's account for one Swarm launch of the study, from its kept session ledger and
 * its study record, with no model: whether the point was armed and fired, the rule and action, for a
 * diagnosis what it answered and what the harness established, whether the worker's next reads and
 * edits went to the locations the notice named, the candidate at the point against the delivered
 * one, the delivered tree's scores, and what the decision cost.
 *
 *   node docs/evidence/2026-10-22-adaptive/decision-account.mjs <study-record.json>
 *
 * Diagnosis model calls are told from the worker's by their system prompt, the fixed diagnosis
 * text, matched by digest. "Followed" means only that a later worker read or landed edit touched a
 * path the notice named; it says nothing about whether the advice was right.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { diagnosisSystemPrompt } from "../../../src/agent-decision-point.ts";

const recordPath = process.argv[2];
const study = JSON.parse(readFileSync(recordPath, "utf8"));
const out = {
  task: study.task,
  sample: study.sample ?? 1,
  arm: study.arm,
  outcome: study.outcome,
  scores: study.scores
    ? {
        visible: study.scores.visible.passed,
        hidden: study.scores.hidden.verdict,
        staticApplicable: study.scores.static.applicable,
        staticPassed: study.scores.static.passed,
        introducedStaticFailure: study.scores.static.introducedFailure,
      }
    : null,
  productVerdict: study.invocation?.productVerdict?.acceptable ?? null,
  claimed: study.invocation?.claimedSuccess ?? null,
  wallMs: study.invocation?.wallMs ?? null,
  tokens: study.invocation?.tokens ?? null,
  deliveredPatch: study.finalPatchDigest ?? null,
  deliveredBytes: study.finalPatchBytes ?? null,
};

const ledgerPath = study.evidence === undefined ? null : findLedger(study.evidence);
if (ledgerPath === null) {
  out.session = "no kept session";
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}
const blobs = join(dirname(ledgerPath), "blobs");
const records = readFileSync(ledgerPath, "utf8").trim().split("\n").map(JSON.parse);
const payload = (record) => {
  const bytes = readFileSync(join(blobs, `${record.payloadDigest.slice(7)}.json`));
  if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== record.payloadDigest)
    throw new Error(`payload of record ${record.sequence} differs from its digest`);
  return JSON.parse(bytes);
};

const diagnosisSystem = new Set(
  records
    .filter((record) => record.type === "transcript-component")
    .filter((record) => {
      const value = payload(record);
      return value.kind === "system" && value.value === diagnosisSystemPrompt;
    })
    .map((record) => record.payloadDigest),
);
const isDiagnosisCall = (record) => diagnosisSystem.has(payload(record).prompt?.system);

const decisions = [];
const armed = [];
for (const record of records) {
  if (record.type !== "verification-command") continue;
  const value = payload(record);
  if (value.rule !== "adaptive-decision-v1") continue;
  if (value.phase === "armed") armed.push({ loop: value.loop, atStep: value.atStep, atElapsedMs: value.atElapsedMs });
  else decisions.push({ sequence: record.sequence, timestamp: record.timestamp, ...value });
}
out.armed = armed;

const workerCalls = records.filter((record) => record.type === "model-call" && !isDiagnosisCall(record));
const diagnosisCalls = records.filter((record) => record.type === "model-call" && isDiagnosisCall(record));
out.modelCalls = { worker: workerCalls.length, diagnosis: diagnosisCalls.length };

// Worker tool outcomes in order, without the harness's own calls at the point and without the
// diagnosis's reads (those run between the decision's start and its record, from its chokepoint).
const outcomes = [];
for (const record of records) {
  if (record.type !== "tool-call") continue;
  const value = payload(record);
  if (value.decision === "requested") continue;
  if (String(value.callId).startsWith("harness-decision-")) continue;
  outcomes.push({ sequence: record.sequence, timestamp: record.timestamp, tool: value.toolName, path: value.input?.path ?? null, allowed: value.decision === "allowed", output: String(value.output ?? "") });
}
const landed = (outcome) => outcome.allowed && ["write", "edit"].includes(outcome.tool) && /^(wrote|replaced|created)/.test(outcome.output);
out.firstLandedEdit = outcomes.find(landed)?.sequence ?? null;

out.decisions = decisions.map((decision) => {
  const named = (decision.diagnosis?.locations ?? []).map((location) => location.path);
  const after = outcomes.filter((outcome) => outcome.sequence > decision.sequence);
  const beforeDecision = outcomes.filter((outcome) => outcome.sequence < decision.sequence);
  const nextEdit = after.find(landed) ?? null;
  return {
    loop: decision.loop,
    step: decision.step,
    rule: decision.chosenBy,
    action: decision.action,
    remaining: decision.remaining,
    signals: decision.signals,
    candidateAtPoint: decision.candidate,
    landedEditsBefore: beforeDecision.filter(landed).length,
    notice: decision.notice !== null,
    diagnosis:
      decision.diagnosis === undefined
        ? null
        : {
            stopReason: decision.diagnosis.stopReason,
            parsed: decision.diagnosis.parsed,
            parseError: decision.diagnosis.parseError,
            actionable: decision.diagnosis.actionable,
            locations: decision.diagnosis.locations,
            rejectedLocations: decision.diagnosis.rejectedLocations,
            approachGrounded: decision.diagnosis.approachGrounded,
            execution: decision.diagnosis.execution,
            hypotheses: (decision.diagnosis.hypotheses ?? []).map((h) => ({ id: h.id, status: h.status, statement: h.statement })),
            answer: decision.diagnosis.answer,
          },
    retrieved: decision.retrieved ?? null,
    spent: decision.spent,
    followed: {
      nextLandedEdit: nextEdit === null ? null : { sequence: nextEdit.sequence, path: nextEdit.path },
      nextEditAtNamedPath: nextEdit !== null && named.includes(nextEdit.path),
      laterReadsOfNamedPaths: after.filter((outcome) => outcome.tool === "read" && named.includes(outcome.path)).length,
      landedEditsAfter: after.filter(landed).length,
      editedPathsAfter: [...new Set(after.filter(landed).map((outcome) => outcome.path))],
    },
  };
});
console.log(JSON.stringify(out, null, 2));

function findLedger(directory) {
  if (!existsSync(directory)) return null;
  if (existsSync(join(directory, "ledger.jsonl"))) return join(directory, "ledger.jsonl");
  for (const entry of readdirSync(directory, { recursive: true }))
    if (String(entry).endsWith("ledger.jsonl")) return join(directory, String(entry));
  return null;
}
