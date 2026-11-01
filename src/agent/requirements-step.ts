import type { EvidenceRecorder } from "../evidence/session.ts";
import { evidenceRef } from "./exchange.ts";
import { completionMarker } from "./prompt.ts";
import { applyProposal, type RequirementRecord, recordSha256 } from "./requirement-record.ts";

export interface RequirementsStep {
  readonly record: RequirementRecord;
  /** The requirement ids now recorded, for the log line. */
  readonly ids: string;
  /** What the model reads next turn. */
  readonly note: string;
  /** The ledger record that holds the record as proposed. */
  readonly evidence: string;
}

/** Applies a proposed requirements block to the record and keeps the result as evidence. */
export async function runRequirementsStep(input: {
  readonly task: string;
  readonly record: RequirementRecord;
  readonly json: string;
  readonly evidence: EvidenceRecorder;
  readonly actor: string;
}): Promise<RequirementsStep> {
  const record = applyProposal(input.task, input.record, input.json);
  const recorded = await input.evidence.record({
    type: "requirements",
    actor: input.actor,
    provenance: ["model"],
    // Through JSON, so the ledger stores the record as plain data.
    payload: JSON.parse(
      JSON.stringify({
        recordSha256: recordSha256(record),
        requirements: record.requirements,
        notes: record.notes,
      }),
    ),
  });
  const ids = record.requirements.map((one) => one.id).join(", ");
  const note = [
    `Recorded ${ids}.`,
    ...record.notes,
    `When the task is done, reply with ${completionMarker} on a line of its own, outside any block.`,
  ].join("\n");
  return { record, ids, note, evidence: evidenceRef(recorded.record.payloadDigest) };
}
