import { z } from "zod";
import { asJsonValue, digestOfJson } from "../evidence/canonical-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { replayCampaignHistory } from "./campaign-history.ts";
import { goalCampaignReport } from "./goal-campaign-report.ts";
import { goalCampaignMetricsSchema } from "./goal-observation.ts";
import { freezeProtocol, protocolSchedule } from "./protocol.ts";
import { pairedNonInferiority, wilsonInterval } from "./statistics.ts";

export const campaignOutcomeSchema = z
  .object({
    executionId: z.string(),
    goal: goalCampaignMetricsSchema.optional(),
    status: z.enum(["completed", "crashed", "cancelled", "infrastructure-failure"]),
    certified: z.boolean().nullable(),
    heldBackAccepted: z.boolean().nullable(),
    costUsd: z.number().nonnegative().nullable(),
    latencyMs: z.number().nonnegative(),
    evidenceDigest: z.string().nullable(),
    cleanup: z.enum(["confirmed", "failed", "unmeasured"]),
  })
  .superRefine((outcome, context) => {
    if (
      outcome.status === "completed" &&
      (outcome.certified === null ||
        outcome.heldBackAccepted === null ||
        outcome.evidenceDigest === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "completed outcomes require both judgements and an evidence digest",
      });
    }
  });
export type CampaignOutcome = z.infer<typeof campaignOutcomeSchema>;

export async function openCampaign(
  input: unknown,
  evidence: EvidenceRecorder,
  options: { resume?: boolean } = {},
) {
  const frozen = freezeProtocol(input);
  const declarations = evidence.records().filter((entry) => entry.type === "campaign-protocol");
  if (declarations.length > 0) {
    if (!options.resume) throw new Error("campaign protocol is already frozen on this chain");
    if (declarations.length !== 1 || declarations[0]?.actor !== "harness")
      throw new Error("campaign protocol lacks unique harness authority");
    const payload = z
      .object({ protocol: z.unknown(), digest: z.string() })
      .parse(evidence.payloads().get(declarations[0].payloadDigest));
    if (
      payload.digest !== frozen.digest ||
      digestOfJson(asJsonValue(payload.protocol)) !== frozen.digest
    )
      throw new Error("resume must preserve the frozen campaign protocol");
  } else {
    if (options.resume) throw new Error("campaign has no frozen history to resume");
    await evidence.record({
      type: "campaign-protocol",
      actor: "harness",
      provenance: ["user"],
      payload: frozen,
    });
  }
  const schedule = protocolSchedule(frozen.protocol);
  const parseOutcome = (input: unknown) => {
    const outcome = campaignOutcomeSchema.parse(input);
    if (frozen.protocol.version === 2) {
      const planned = schedule.find((entry) => entry.executionId === outcome.executionId);
      const goal = frozen.protocol.cases.find((entry) => entry.id === planned?.caseId);
      if (
        outcome.goal === undefined ||
        goal === undefined ||
        outcome.goal.required !== goal.requirementIds.length
      )
        throw new Error("goal outcome must account for the complete frozen requirement set");
      if (
        outcome.certified === true &&
        (outcome.goal.accepted !== outcome.goal.required || outcome.goal.missedChecks.length > 0)
      )
        throw new Error("incomplete goal cannot be accepted");
    }
    return outcome;
  };
  const { launched, outcomes, deferred } = replayCampaignHistory(
    evidence,
    frozen.digest,
    schedule,
    parseOutcome,
  );
  let cleanupFailed = [...outcomes.values()].some((outcome) => outcome.cleanup !== "confirmed");
  return {
    schedule,
    completed: (executionId: string) => outcomes.has(executionId),
    unresolved: () => [...launched].filter((id) => !outcomes.has(id)),
    async deferRemaining(reason: string) {
      for (const entry of schedule.filter((entry) => !launched.has(entry.executionId))) {
        await evidence.record({
          type: "campaign-observation",
          actor: "harness",
          provenance: ["tool-output"],
          payload: { phase: "not-launched", protocolDigest: frozen.digest, ...entry, reason },
        });
        deferred.set(entry.executionId, reason);
      }
    },
    async launch(executionId: string) {
      if (options.resume && [...launched].some((id) => !outcomes.has(id)))
        throw new Error("unsettled campaign launch requires effect and usage reconciliation");
      if (cleanupFailed)
        throw new Error("campaign dispatch stopped because runtime cleanup failed");
      const planned = schedule.find((entry) => entry.executionId === executionId);
      if (planned === undefined || launched.has(executionId))
        throw new Error("unplanned or duplicate campaign launch");
      await evidence.record({
        type: "campaign-observation",
        actor: "harness",
        provenance: ["tool-output"],
        payload: { phase: "launched", protocolDigest: frozen.digest, ...planned },
      });
      launched.add(executionId);
      deferred.delete(executionId);
    },
    async settle(input: unknown) {
      const outcome = parseOutcome(input);
      if (!launched.has(outcome.executionId) || outcomes.has(outcome.executionId))
        throw new Error("outcome has no unique launched execution");
      await evidence.record({
        type: "campaign-observation",
        actor: "harness",
        provenance: ["tool-output"],
        payload: asJsonValue({ phase: "settled", protocolDigest: frozen.digest, ...outcome }),
      });
      outcomes.set(outcome.executionId, outcome);
      cleanupFailed ||= outcome.cleanup !== "confirmed";
    },
    report() {
      const rows = [...outcomes.values()];
      const certified = rows.filter((row) => row.certified === true);
      const falseGreens = certified.filter((row) => row.heldBackAccepted === false).length;
      const unknown =
        launched.size -
        rows.filter((row) => row.certified !== null && row.heldBackAccepted !== null).length;
      return {
        protocolDigest: frozen.digest,
        ...(frozen.protocol.version === 2
          ? { goal: goalCampaignReport(frozen.protocol, outcomes) }
          : {}),
        notLaunched: [...deferred].map(([executionId, reason]) => ({ executionId, reason })),
        scheduled: schedule.length,
        launched: launched.size,
        completed: rows.filter((row) => row.status === "completed").length,
        certified: certified.length,
        falseGreens,
        unknown,
        pending: launched.size - outcomes.size,
        independentRepositories:
          frozen.protocol.version === 2
            ? null
            : new Set(
                schedule
                  .filter((entry) => launched.has(entry.executionId))
                  .map((entry) => entry.repository),
              ).size,
        arms: frozen.protocol.arms.map((arm) => {
          const armSchedule = schedule.filter((entry) => entry.armId === arm.id);
          const armRows = armSchedule.flatMap((entry) => {
            const outcome = outcomes.get(entry.executionId);
            return outcome === undefined ? [] : [outcome];
          });
          const certified = armRows.filter((entry) => entry.certified === true);
          const failures = certified.filter((entry) => entry.heldBackAccepted === false).length;
          const interval =
            frozen.protocol.version === 2 || certified.length === 0
              ? null
              : wilsonInterval(failures, certified.length);
          return {
            armId: arm.id,
            launched: armSchedule.filter((entry) => launched.has(entry.executionId)).length,
            settled: armRows.length,
            certified: certified.length,
            falseGreens: failures,
            interval,
            precisionMet:
              frozen.protocol.version === 1 &&
              interval !== null &&
              interval.upper <= frozen.protocol.targetUpperBound,
          };
        }),
        comparisons: (frozen.protocol.version === 1 ? frozen.protocol.arms : [])
          .filter((arm) => arm.id !== frozen.protocol.baseline)
          .map((arm) => {
            const pairs = frozen.protocol.cases.flatMap((one) => {
              const rows = schedule.filter(
                (entry) => entry.caseId === one.id && entry.seed === frozen.protocol.seeds[0],
              );
              const left = outcomes.get(
                rows.find((entry) => entry.armId === frozen.protocol.baseline)?.executionId ?? "",
              );
              const right = outcomes.get(
                rows.find((entry) => entry.armId === arm.id)?.executionId ?? "",
              );
              return left === undefined || right === undefined
                ? []
                : [
                    {
                      baseline: left.heldBackAccepted === true,
                      candidate: right.heldBackAccepted === true,
                    },
                  ];
            });
            return {
              armId: arm.id,
              pairs: pairs.length,
              ...pairedNonInferiority(
                frozen.protocol.version === 1 ? pairs : [],
                frozen.protocol.version === 1 ? frozen.protocol.margin : 0.05,
              ),
            };
          }),
        eligibleForConfirmatoryAnalysis:
          frozen.protocol.version === 1 &&
          frozen.protocol.exposure === "held-out" &&
          frozen.protocol.seeds.length === 1 &&
          launched.size === schedule.length &&
          outcomes.size === schedule.length &&
          unknown === 0 &&
          !cleanupFailed,
        cleanupFailed,
      };
    },
  };
}
