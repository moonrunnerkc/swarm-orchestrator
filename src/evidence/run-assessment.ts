import { z } from "zod";
import type { AgentLoopOutcome } from "../core/loop.ts";
import type { GatesEngineRun } from "../gates/engine.ts";
import type { JsonValue } from "./canonical-json.ts";
import { asJsonValue } from "./canonical-json.ts";
import type { EvidenceRecorder } from "./session.ts";
import type { TaskContract } from "./task-contract.ts";
import { type RunVerdict, runVerdict, runVerdictSchema } from "./verdict.ts";

export const assessmentInputsSchema = z.object({
  policy: z.enum(["run-acceptance-v1", "run-acceptance-v2"]),
  requiredChecks: z.array(z.string().min(1)).optional(),
  contractRecord: z.string().optional(),
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
  contract?: TaskContract,
): Promise<RunVerdict> {
  const inputs = assessmentInputsSchema.parse({
    policy: contract === undefined ? "run-acceptance-v1" : "run-acceptance-v2",
    ...(contract === undefined
      ? {}
      : {
          requiredChecks: contract.requiredChecks,
          contractRecord: evidence
            .records()
            .find(
              (entry) =>
                entry.type === "task-contract" &&
                (evidence.payloads().get(entry.payloadDigest) as { phase?: string } | undefined)
                  ?.phase === "effective",
            )?.payloadDigest,
        }),
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

/** Project final goal acceptance onto the recorded worker verdict without replacing its assurances. */
export async function recordGoalAssessment(
  evidence: EvidenceRecorder,
  verificationDigest: string,
): Promise<RunVerdict> {
  const prior = evidence.records().findLast((record) => record.type === "run-assessment");
  if (prior === undefined)
    throw new Error("final goal assessment requires a recorded worker assessment");
  const base = z
    .object({ inputs: assessmentInputsSchema, verdict: runVerdictSchema })
    .parse(evidence.payloads().get(prior.payloadDigest));
  const captured = evidence
    .records()
    .find(
      (record) =>
        record.type === "independent-verification" &&
        record.payloadDigest === verificationDigest &&
        record.sequence > prior.sequence,
    );
  if (captured === undefined)
    throw new Error("final goal assessment needs a subsequent independent verification record");
  const independent = z
    .object({
      certificationPolicy: z.literal("goal-obligations-v1"),
      verified: z.boolean(),
      task: z.enum(["accepted", "rejected", "unjudged", "vacuous"]),
      advice: z.string(),
      sourcePatchDigest: z.string(),
      sourceBase: z.string(),
    })
    .parse(evidence.payloads().get(verificationDigest));
  const diffRecord = evidence
    .records()
    .findLast((record) => record.type === "workspace-diff" && record.sequence < prior.sequence);
  const diff = z
    .object({ rawPatchDigest: z.string() })
    .parse(evidence.payloads().get(diffRecord?.payloadDigest ?? ""));
  const seal = evidence.records().find((record) => record.type === "run-spec-sealed");
  const spec = z
    .object({ spec: z.object({ repository: z.object({ baseCommit: z.string() }) }) })
    .parse(evidence.payloads().get(seal?.payloadDigest ?? ""));
  if (
    diff.rawPatchDigest !== independent.sourcePatchDigest ||
    spec.spec.repository.baseCommit !== independent.sourceBase
  )
    throw new Error(
      "final independent verification does not describe the worker's assessed source",
    );
  const verdict: RunVerdict = {
    ...base.verdict,
    task: independent.task === "vacuous" ? "unjudged" : independent.task,
    acceptable: base.verdict.acceptable && independent.verified,
    reasons: {
      ...base.verdict.reasons,
      task: independent.advice || `pinned goal checks: ${independent.task}`,
    },
  };
  await evidence.record({
    type: "run-assessment",
    actor: "harness",
    provenance: ["tool-output"],
    payload: asJsonValue({
      inputs: {
        policy: "run-acceptance-v3",
        previousAssessment: prior.payloadDigest,
        independentRecord: verificationDigest,
        sourceRecord: diffRecord?.payloadDigest,
      },
      verdict,
    }),
  });
  return verdict;
}
