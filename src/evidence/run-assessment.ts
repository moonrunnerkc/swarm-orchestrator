import { z } from "zod";
import type { AgentLoopOutcome } from "../core/loop.ts";
import type { GatesEngineRun } from "../gates/engine.ts";
import { justifiedRecords } from "../gates/gate-runner.ts";
import type { JsonValue } from "./canonical-json.ts";
import { asJsonValue } from "./canonical-json.ts";
import type { LedgerRecord } from "./ledger-record.ts";
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
 * Where a loop that stopped at its wall stood against the run's allowance (`wallStopOf`). The
 * reserve record is the run's `verification-reserve-v1` budget; the other two are read off the
 * chain against it.
 */
const wallStopSchema = z.strictObject({
  reserveRecord: z.string(),
  beforeDeadline: z.boolean(),
  effectsSettled: z.boolean(),
});

/**
 * v1 and v2 are the recorded policies of earlier runs and keep their meaning: any failed policy
 * gate refuses. v4 is v2 with the contract optional and one more input, the advisory demands a
 * verified worker claim answered. v5 is v4 with the wall stop read against the run's allowance:
 * a loop cut at the end of its model work, before the run's deadline and with no effect in flight,
 * is not refused for the cut, as a loop stopped at its step limit is not; every other condition
 * still applies to the checked tree. Under v1 to v4 a wall stop refuses on its own, and their
 * records keep that meaning. The bundled verifier re-derives each by its own rule.
 */
export const assessmentInputsSchema = z.object({
  policy: z.enum([
    "run-acceptance-v1",
    "run-acceptance-v2",
    "run-acceptance-v4",
    "run-acceptance-v5",
  ]),
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
  wallStop: wallStopSchema.nullable().optional(),
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
  const stop = lifecycleStop(evidence);
  const inputs = assessmentInputsSchema.parse({
    policy: "run-acceptance-v5",
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
    lifecycleRecord: stop?.payloadDigest ?? null,
    lifecycle,
    wallStop: lifecycle === "max-wall-time" ? wallStopOf(evidence, stop) : null,
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

/**
 * Whether a loop's wall stop was the end of its model work or the end of the run. A run that holds
 * a share of its total allowance for the final checks records it (`verification-reserve-v1`) and
 * ends model work that much before its deadline, so a loop cut there was cut so the delivered tree
 * could still be checked, and those checks decide the run. Read off this run's part of the chain,
 * by the rule the bundled verifier mirrors: the last reserve recorded; whether the loop's stop was
 * recorded before the deadline that reserve names; and whether every write and shell call that
 * was requested settled, none of them at or after the model-work cutoff, where the cutoff can stop
 * a command mid-effect. Null where no reserve was recorded or no loop stopped, which leaves a wall
 * stop refusing as it always did.
 */
function wallStopOf(
  evidence: EvidenceRecorder,
  stop: LedgerRecord | undefined,
): z.infer<typeof wallStopSchema> | null {
  const payloads = evidence.payloads();
  const thisRun = recordsOfThisRun(evidence);
  const reserve = thisRun.findLast(
    (entry) =>
      entry.type === "session-budget" &&
      (payloads.get(entry.payloadDigest) as { rule?: unknown } | undefined)?.rule ===
        "verification-reserve-v1",
  );
  const window = z
    .object({ deadline: z.number(), modelWorkEnds: z.number() })
    .safeParse(reserve === undefined ? undefined : payloads.get(reserve.payloadDigest));
  if (reserve === undefined || stop === undefined || !window.success) return null;
  const calls = thisRun
    .filter((entry) => entry.type === "tool-call")
    .map((entry) => ({
      sequence: entry.sequence,
      timestamp: entry.timestamp,
      call: payloads.get(entry.payloadDigest) as
        | { callId?: unknown; kind?: unknown; decision?: unknown }
        | undefined,
    }))
    .filter(({ call }) => call?.kind === "write" || call?.kind === "shell");
  // Every request has a later settlement under its id, and none that ran (a denied call had no
  // effect) settled at or after the cutoff.
  const effectsSettled = calls.every(
    (one) =>
      (one.call?.decision !== "requested" ||
        calls.some(
          (later) =>
            later.sequence > one.sequence &&
            later.call?.callId === one.call?.callId &&
            later.call?.decision !== "requested",
        )) &&
      (!(one.call?.decision === "allowed" || one.call?.decision === "failed") ||
        one.timestamp < window.data.modelWorkEnds),
  );
  return {
    reserveRecord: reserve.payloadDigest,
    beforeDeadline: stop.timestamp < window.data.deadline,
    effectsSettled,
  };
}

/** This run's part of the chain: everything after the last run assessment recorded on it. */
function recordsOfThisRun(evidence: EvidenceRecorder): readonly LedgerRecord[] {
  const previous = evidence
    .records()
    .findLast((entry) => entry.type === "run-assessment")?.sequence;
  return evidence.records().filter((entry) => previous === undefined || entry.sequence > previous);
}

/**
 * The last stop of a loop that worked the task, on this run's part of the chain, by the rule the
 * bundled verifier mirrors. A repair attempt withheld for want of budget is recorded as a stop
 * too, but it never ran a loop and its reason is not a lifecycle. An owed attempt (the task's
 * continuation, or the follow-up on unresolved outcomes) whose candidate was not kept changed
 * nothing delivered, so its stop is not the run's lifecycle. A narrow repair that finished says
 * its stop is not the run's (`runLifecycle: false`): it finished the repair, not the task, and
 * the loop that stopped at its step limit before it is still the one that worked the task.
 * Records that predate these fields read as they always did.
 */
function lifecycleStop(evidence: EvidenceRecorder) {
  const payloads = evidence.payloads();
  const thisRun = recordsOfThisRun(evidence);
  const owed = thisRun
    .map(
      (entry) =>
        payloads.get(entry.payloadDigest) as
          | { rule?: unknown; state?: unknown; accepted?: unknown; attempt?: unknown }
          | undefined,
    )
    .filter(
      (payload) =>
        payload?.rule === "outcome-follow-up-v1" || payload?.rule === "task-continuation-v1",
    );
  const kept = (attempt: unknown): boolean => {
    const record =
      typeof attempt === "number" ? owed.find((one) => one?.attempt === attempt) : owed.at(-1);
    return record?.state === "given" && record.accepted === true;
  };
  return thisRun.findLast((entry) => {
    if (entry.type !== "session-stopped") return false;
    const stopped = payloads.get(entry.payloadDigest) as
      | { stopReason?: unknown; followUp?: unknown; attempt?: unknown; runLifecycle?: unknown }
      | undefined;
    if (!(loopLifecycles as readonly unknown[]).includes(stopped?.stopReason)) return false;
    if (stopped?.runLifecycle === false) return false;
    if (stopped?.followUp === true && !kept(stopped.attempt)) return false;
    return true;
  });
}

/** The run's lifecycle as the chain records it, or null where no loop has stopped. */
export function runLifecycle(evidence: EvidenceRecorder): AgentLoopOutcome["stopReason"] | null {
  const stop = lifecycleStop(evidence);
  if (stop === undefined) return null;
  const reason = (evidence.payloads().get(stop.payloadDigest) as { stopReason?: unknown })
    ?.stopReason;
  return (loopLifecycles as readonly unknown[]).includes(reason)
    ? (reason as AgentLoopOutcome["stopReason"])
    : null;
}
