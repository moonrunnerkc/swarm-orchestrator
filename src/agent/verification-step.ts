import type { EvidenceRecorder } from "../evidence/session.ts";
import { evidenceRef } from "./exchange.ts";
import type { Verification } from "./loop-types.ts";
import type { RequirementRecord } from "./requirement-record.ts";

/**
 * The tree verified under the record, kept as evidence, and whether it is the same tree and
 * record the last verification measured, which would only repeat its findings.
 */
export async function runVerificationStep(input: {
  readonly verify: (record: RequirementRecord) => Promise<Verification>;
  readonly record: RequirementRecord;
  readonly last: Verification | null;
  readonly evidence: EvidenceRecorder;
}): Promise<{
  readonly judged: Verification;
  readonly repeated: boolean;
  /** The ledger record of this verification. */
  readonly evidence: string;
}> {
  const judged = await input.verify(input.record);
  const repeated =
    input.last !== null &&
    input.last.patchSha256 === judged.patchSha256 &&
    input.last.recordSha256 === judged.recordSha256;
  const recorded = await input.evidence.record({
    type: "verification",
    actor: "harness",
    provenance: ["tool-output"],
    payload: {
      state: judged.state,
      patchSha256: judged.patchSha256,
      recordSha256: judged.recordSha256,
    },
  });
  return { judged, repeated, evidence: evidenceRef(recorded.record.payloadDigest) };
}
