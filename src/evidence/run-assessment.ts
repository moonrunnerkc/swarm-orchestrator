import { z } from "zod";
import type { AgentLoopOutcome } from "../core/loop.ts";
import type { GatesEngineRun } from "../gates/engine.ts";
import type { JsonValue } from "./canonical-json.ts";
import type { EvidenceRecorder } from "./session.ts";
import { type RunVerdict, runVerdict } from "./verdict.ts";

export const assessmentInputsSchema = z.object({
  policy: z.literal("run-acceptance-v1"),
  lifecycle: z.enum([
    "completed",
    "interrupted",
    "max-steps",
    "max-tokens",
    "max-wall-time",
    "model-error",
    "output-cap",
    "empty-response",
  ]),
  cancelled: z.boolean(),
  settled: z.enum(["green", "escalated"]),
  baseRatchetAccepted: z.boolean(),
  vacuousBlockingBonds: z.array(z.string()),
  changedFiles: z.number().int().nonnegative(),
  gateRecords: z.array(z.string()),
  baseRatchetRecord: z.string(),
  lifecycleRecord: z.string().nullable(),
});

export async function recordRunAssessment(
  evidence: EvidenceRecorder,
  gates: GatesEngineRun,
  lifecycle: AgentLoopOutcome["stopReason"],
  executionTrust: RunVerdict["executionTrust"],
  cancelled: boolean,
): Promise<RunVerdict> {
  const inputs = assessmentInputsSchema.parse({
    policy: "run-acceptance-v1",
    lifecycleRecord:
      evidence.records().findLast((entry) => entry.type === "session-stopped")?.payloadDigest ??
      null,
    lifecycle,
    cancelled,
    settled: gates.outcome.settled,
    baseRatchetAccepted: gates.outcome.baseComparison.decision.accepted,
    vacuousBlockingBonds: gates.bonds
      .filter((bond) => bond.severity === "blocking" && bond.verdict === "vacuous")
      .map((bond) => bond.gateId),
    changedFiles: gates.outcome.finalCycle.measures.changedFiles ?? 0,
    gateRecords: gates.outcome.finalCycle.runs.map((run) => run.record),
    baseRatchetRecord: gates.outcome.baseComparison.ratchetRecord,
  });
  const verdict = runVerdict({
    cycle: gates.outcome.finalCycle,
    integrity: "unverified",
    signer: "untrusted",
    executionTrust,
    assessment: inputs,
  });
  await evidence.record({
    type: "run-assessment",
    actor: "harness",
    provenance: ["tool-output"],
    payload: { inputs, verdict: { ...verdict } } as JsonValue,
  });
  return verdict;
}
