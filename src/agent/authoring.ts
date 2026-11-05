import type { EvidenceRecorder } from "../evidence/session.ts";
import type { Chokepoint } from "../tools/chokepoint.ts";
import { type Authored, authorChecks, sealAuthored } from "./check-author.ts";
import type { ModelClient } from "./model.ts";
import { type RequirementRecord, withAuthored } from "./requirement-record.ts";
import { testConventions } from "./test-conventions.ts";

/**
 * Between recording the requirements and the first edit: checks for R1 written by a fresh-context
 * call that never sees the change, run at the base, and sealed outside the tree where the verifier
 * judges with them. R1's kind and authored claims are held from here on. Where no check survives,
 * the record is unchanged and R1 can be satisfied only by independent evidence from elsewhere.
 */
export async function authoringStage(input: {
  readonly model: ModelClient;
  readonly chokepoint: Chokepoint;
  readonly evidence: EvidenceRecorder;
  readonly workspace: string;
  readonly task: string;
  readonly record: RequirementRecord;
  readonly home: string;
  readonly turnTokens: number;
  readonly signal?: AbortSignal | undefined;
}): Promise<{ readonly record: RequirementRecord; readonly authored: readonly Authored[] }> {
  const requirement = input.record.requirements.find((one) => one.id === "R1");
  if (requirement === undefined) return { record: input.record, authored: [] };
  const conventions = await testConventions(input.workspace, input.task);
  const authored = await authorChecks({ ...input, requirement, conventions });
  await sealAuthored(input.workspace, [authored], input.home);
  const record =
    authored.kind === null
      ? input.record
      : withAuthored(input.record, authored.kind, authored.structure);
  return { record, authored: [authored] };
}
