import type { RatchetSummary } from "../gates/ratchet-summary.ts";
import {
  type AssignmentKind,
  type CostSource,
  type RewardEntry,
  rewardEntrySchema,
  routingLogSchemaVersion,
} from "./routing-log.ts";
import type { TaskClass } from "./task-class.ts";

/**
 * Section 3.8's reward, with its first correction built in: a gate pass that tripped the
 * ratchet scores as a failure. Without that, the signal the router learns from is gate pass
 * rate, and gate pass rate rewards whichever model is best at weakening tests.
 */

interface RewardWeights {
  /** How much of the reward each retry costs. Higher is stricter. */
  readonly attemptPenalty: number;
  /** The latency at which a run keeps half its reward. */
  readonly referenceLatencyMs: number;
  /** The cost at which a run keeps half its reward. */
  readonly referenceCostUsd: number;
}

/**
 * Reference points, not measurements. They set where the curve bends, and the honest thing to
 * say about the numbers is that they are a starting position to be tuned against real runs.
 */
export const defaultRewardWeights: RewardWeights = {
  attemptPenalty: 0.5,
  referenceLatencyMs: 120_000,
  referenceCostUsd: 0.05,
};

export interface RewardInput {
  readonly settled: "green" | "escalated";
  /** Attempts the ratchet rejected for trading a measured number the wrong way. */
  readonly erosions: number;
  readonly attempts: number;
  /**
   * How many files the run changed, or null where no gate measured it. Zero is the case
   * this exists for: a run that edited nothing is fast and free, so every other term scores
   * it near the top, and the router would learn that the model which does nothing is the
   * best model available. Null is not zero and is scored normally, since punishing a run
   * for a measurement nobody took is the same mistake pointed the other way.
   */
  readonly changedFiles: number | null;
  readonly latencyMs: number;
  /**
   * Null when the model has no known rate. Scored as a run at the reference cost: neutral,
   * because scoring it as free would hand an unpriced frontier model a local model's
   * advantage, and the router would learn to prefer whatever the table has not priced yet.
   */
  readonly costUsd: number | null;
}

interface RewardScore {
  /** Between zero and one, where zero is a run the router should learn to avoid. */
  readonly reward: number;
  /** One line naming what it weighed, so a routing table reads without the formula. */
  readonly reason: string;
}

export function scoreReward(
  input: RewardInput,
  weights: RewardWeights = defaultRewardWeights,
): RewardScore {
  if (input.settled !== "green") {
    return { reward: 0, reason: "the run escalated, so the gates never went green" };
  }
  if (input.erosions > 0) {
    return {
      reward: 0,
      reason:
        `the gates went green but the ratchet rejected ${input.erosions} attempt(s) for ` +
        "trading a measured number away, which scores as a failure",
    };
  }
  if (input.changedFiles === 0) {
    return {
      reward: 0,
      reason:
        "the gates went green over a workspace the run never changed, so nothing was done " +
        "and there is nothing to reward",
    };
  }

  const forAttempts = 1 / (1 + weights.attemptPenalty * input.attempts);
  const forLatency = weights.referenceLatencyMs / (weights.referenceLatencyMs + input.latencyMs);
  const costUsd = input.costUsd ?? weights.referenceCostUsd;
  const forCost = weights.referenceCostUsd / (weights.referenceCostUsd + costUsd);

  return {
    reward: forAttempts * forLatency * forCost,
    reason:
      `green with ${describeRetries(input.attempts)}, ${Math.round(input.latencyMs / 1000)}s, ` +
      (input.costUsd === null ? "and an unknown cost" : `and $${input.costUsd.toFixed(4)}`),
  };
}

function describeRetries(attempts: number): string {
  return attempts === 1 ? "1 retry" : `${attempts} retries`;
}

interface RewardEntryInput {
  readonly recordedAt: number;
  readonly sessionId: string;
  readonly taskClass: TaskClass;
  readonly model: string;
  readonly assignment: AssignmentKind;
  readonly ratchet: RatchetSummary;
  readonly changedFiles: number | null;
  readonly latencyMs: number;
  readonly costUsd: number | null;
  readonly costSource: CostSource;
}

/**
 * One finished run as the routing log holds it. The ratchet summary is the only source of the
 * outcome and the attempts, so the score and the numbers it was computed from cannot drift
 * apart in the record a reader is looking at.
 */
export function buildRewardEntry(
  input: RewardEntryInput,
  weights: RewardWeights = defaultRewardWeights,
): RewardEntry {
  const score = scoreReward(
    {
      settled: input.ratchet.settled,
      erosions: input.ratchet.erosions,
      attempts: input.ratchet.attempts,
      changedFiles: input.changedFiles,
      latencyMs: input.latencyMs,
      costUsd: input.costUsd,
    },
    weights,
  );

  return rewardEntrySchema.parse({
    schemaVersion: routingLogSchemaVersion,
    recordedAt: input.recordedAt,
    sessionId: input.sessionId,
    taskClass: input.taskClass,
    model: input.model,
    assignment: input.assignment,
    ratchet: { ...input.ratchet },
    attempts: input.ratchet.attempts,
    changedFiles: input.changedFiles,
    latencyMs: input.latencyMs,
    costUsd: input.costUsd,
    costSource: input.costSource,
    reward: score.reward,
    rewardReason: score.reason,
  });
}
