import type { EvidenceRecorder } from "../evidence/session.ts";
import type { Chokepoint } from "../tools/chokepoint.ts";
import { type Authored, authorChecks, sealAuthored } from "./check-author.ts";
import type { ModelClient } from "./model.ts";
import { type RequirementRecord, withAuthored } from "./requirement-record.ts";
import { testConventions } from "./test-conventions.ts";
import { createTurnChecks, type TurnChecks } from "./turn-checks.ts";

/**
 * Between recording the requirements and the first edit: checks for R1 written by a fresh-context
 * call that never sees the change, run at the base, and sealed outside the tree where the verifier
 * judges with them; then the harness's checks for the loop, with the declared tests measured at
 * the base. R1's kind and authored claims are held from here on. Where no check survives, R1 can
 * be satisfied only by independent evidence from elsewhere.
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
  /** Where the harness's own check reports go, outside the tree the model works in. */
  readonly scratch: string;
  readonly signal?: AbortSignal | undefined;
}): Promise<{
  readonly record: RequirementRecord;
  readonly authored: readonly Authored[];
  readonly checks: TurnChecks;
}> {
  const requirement = input.record.requirements.find((one) => one.id === "R1");
  const conventions = await testConventions(input.workspace, input.task);
  const authored =
    requirement === undefined ? [] : [await authorChecks({ ...input, requirement, conventions })];
  await sealAuthored(input.workspace, authored, input.home);
  const first = authored[0];
  const record =
    first === undefined || first.kind === null
      ? input.record
      : withAuthored(input.record, first.kind, first.structure, first.behaviorAsked);
  const checks = createTurnChecks({
    chokepoint: input.chokepoint,
    workspace: input.workspace,
    authored: authored.flatMap((one) => (one.test === null ? [] : [one.test])),
    scratch: input.scratch,
    conventions,
  });
  // Still the base: what the declared tests do before any edit, for regressions to be read from.
  await checks.baseline();
  return { record, authored, checks };
}
