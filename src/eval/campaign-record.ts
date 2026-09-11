import { z } from "zod";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { freezeProtocol, protocolSchedule } from "./protocol.ts";
import { pairedNonInferiority, wilsonInterval } from "./statistics.ts";

export const campaignOutcomeSchema = z
  .object({
    executionId: z.string(),
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

export async function openCampaign(input: unknown, evidence: EvidenceRecorder) {
  if (evidence.records().some((entry) => entry.type === "campaign-protocol"))
    throw new Error("campaign protocol is already frozen on this chain");
  const frozen = freezeProtocol(input);
  const schedule = protocolSchedule(frozen.protocol);
  await evidence.record({
    type: "campaign-protocol",
    actor: "harness",
    provenance: ["user"],
    payload: frozen,
  });
  const launched = new Set<string>();
  const outcomes = new Map<string, CampaignOutcome>();
  let cleanupFailed = false;
  return {
    schedule,
    async launch(executionId: string) {
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
    },
    async settle(input: unknown) {
      const outcome = campaignOutcomeSchema.parse(input);
      if (!launched.has(outcome.executionId) || outcomes.has(outcome.executionId))
        throw new Error("outcome has no unique launched execution");
      await evidence.record({
        type: "campaign-observation",
        actor: "harness",
        provenance: ["tool-output"],
        payload: { phase: "settled", protocolDigest: frozen.digest, ...outcome },
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
        scheduled: schedule.length,
        launched: launched.size,
        completed: rows.filter((row) => row.status === "completed").length,
        certified: certified.length,
        falseGreens,
        unknown,
        pending: launched.size - outcomes.size,
        independentRepositories: new Set(
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
            certified.length === 0 ? null : wilsonInterval(failures, certified.length);
          return {
            armId: arm.id,
            launched: armSchedule.filter((entry) => launched.has(entry.executionId)).length,
            settled: armRows.length,
            certified: certified.length,
            falseGreens: failures,
            interval,
            precisionMet: interval !== null && interval.upper <= frozen.protocol.targetUpperBound,
          };
        }),
        comparisons: frozen.protocol.arms
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
              ...pairedNonInferiority(pairs, frozen.protocol.margin),
            };
          }),
        eligibleForConfirmatoryAnalysis:
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
