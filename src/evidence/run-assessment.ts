import { z } from "zod";
import type { AgentLoopOutcome } from "../core/loop.ts";
import type { GatesEngineRun } from "../gates/engine.ts";
import { justifiedRecords } from "../gates/gate-runner.ts";
import type { JsonValue } from "./canonical-json.ts";
import { asJsonValue } from "./canonical-json.ts";
import type { EvidenceRecorder } from "./session.ts";
import type { TaskContract } from "./task-contract.ts";
import { type RunVerdict, runVerdict, runVerdictSchema } from "./verdict.ts";

/** How a loop can stop: the lifecycle an assessment names, and the stop records that are a loop's. */
const loopLifecycles = [
  "completed",
  "interrupted",
  "max-steps",
  "max-tokens",
  "max-wall-time",
  "model-error",
  "output-cap",
  "empty-response",
  "stalled",
] as const;

/**
 * v1 and v2 are the recorded policies of earlier runs and keep their meaning: any failed policy
 * gate refuses. v4 is v2 with the contract optional and one more input, the advisory demands a
 * verified worker claim answered; the bundled verifier re-derives each by its own rule.
 */
export const assessmentInputsSchema = z.object({
  policy: z.enum(["run-acceptance-v1", "run-acceptance-v2", "run-acceptance-v4"]),
  requiredChecks: z.array(z.string().min(1)).optional(),
  contractRecord: z.string().optional(),
  lifecycle: z.enum(loopLifecycles),
  cancelled: z.boolean(),
  settled: z.enum(["green", "escalated"]),
  baseRatchetAccepted: z.boolean(),
  vacuousBlockingBonds: z.array(z.string()),
  changedFiles: z.number().int().nonnegative(),
  gateRecords: z.array(z.string()),
  baseRatchetRecord: z.string(),
  lifecycleRecord: z.string().nullable(),
  justifications: z
    .array(z.strictObject({ gateRecord: z.string(), claimRecord: z.string() }))
    .optional(),
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
    policy: "run-acceptance-v4",
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
    // The last stop of a loop. A repair attempt withheld for want of budget is recorded as a
    // stop too, but it never ran a loop and its reason is not a lifecycle; naming it here put a
    // record beside a lifecycle it does not carry, and the bundle's own verifier refused it.
    lifecycleRecord:
      evidence.records().findLast((entry) => {
        if (entry.type !== "session-stopped") return false;
        const stopReason = (
          evidence.payloads().get(entry.payloadDigest) as { stopReason?: unknown }
        )?.stopReason;
        return (loopLifecycles as readonly unknown[]).includes(stopReason);
      })?.payloadDigest ?? null,
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
    justifications: justificationsFor(evidence, gates),
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

/** The final cycle's advisory demands that a verified worker claim answers, in run order. */
function justificationsFor(evidence: EvidenceRecorder, gates: GatesEngineRun) {
  const justified = justifiedRecords(evidence);
  return gates.outcome.finalCycle.advisoryFailures.flatMap((run) => {
    const claimRecord = justified.get(run.record);
    return run.measures.justificationRequired === 1 && claimRecord !== undefined
      ? [{ gateRecord: run.record, claimRecord }]
      : [];
  });
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
  // Either the verifier judged the source under the goal policy, or it refused before running
  // anything and named why. A refusal is a non-success the assessment records, never a crash:
  // the September pilot ended every refused upgrade run with no verdict and no result line.
  const independent = z
    .union([
      z.object({
        certificationPolicy: z.literal("goal-obligations-v1"),
        refusal: z.null().optional(),
        verified: z.boolean(),
        task: z.enum(["accepted", "rejected", "unjudged", "vacuous"]),
        regression: z.enum(["pass", "fail", "unmeasured"]).optional(),
        goalAcceptance: z.object({ obligations: z.array(z.unknown()) }).optional(),
        advice: z.string(),
        sourcePatchDigest: z.string(),
        sourceBase: z.string(),
      }),
      z.object({
        refusal: z.string().min(1),
        verified: z.literal(false),
        task: z.literal("unjudged"),
        advice: z.string(),
        sourcePatchDigest: z.string(),
        sourceBase: z.string(),
      }),
    ])
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
    acceptable: base.verdict.acceptable && (independent.verified || hypothesesOnly(independent)),
    reasons: {
      ...base.verdict.reasons,
      // Mirrored byte for byte by the bundled verifier's re-derivation of this record; a richer
      // account of which requirements were unmet is read off the verification payload by the
      // run outcome display, not written here.
      task:
        "refusal" in independent && independent.refusal != null
          ? `final verification refused: ${independent.refusal}`
          : independent.advice || `pinned goal checks: ${independent.task}`,
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

/**
 * A final verification of a contract that holds the planner's hypotheses and no supplied
 * requirement: there was nothing authorized to certify, so certification refuses, and the run is
 * read as one with no contract is, on whether the fresh checkout regressed. The task stays
 * unjudged. Without this, planning checks made a run unacceptable that the same run without
 * them accepted. Mirrored by the bundled verifier's re-derivation of this record.
 */
function hypothesesOnly(independent: {
  readonly certificationPolicy?: string | undefined;
  readonly refusal?: string | null | undefined;
  readonly regression?: string | undefined;
  readonly goalAcceptance?: { readonly obligations: readonly unknown[] } | undefined;
}): boolean {
  return (
    independent.certificationPolicy === "goal-obligations-v1" &&
    independent.refusal == null &&
    independent.regression === "pass" &&
    independent.goalAcceptance?.obligations.length === 0
  );
}
