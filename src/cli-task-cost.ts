import { shortlistFetchTimeoutMs } from "./cli-select.ts";
import type { EvidenceRecorder } from "./evidence/session.ts";
import type { summarizeRatchet } from "./gates/ratchet-summary.ts";
import { payloadsSince } from "./select/calibration-measures.ts";
import { loadPricing } from "./select/pricing-source.ts";
import { buildRewardEntry } from "./select/reward.ts";
import { defaultRoutingLogPath, openRoutingLog } from "./select/routing-log.ts";
import { classifyTask } from "./select/task-class.ts";
import { costOfTask, type TaskCost } from "./select/task-cost.ts";

/**
 * What this run cost, from its own ledger's token counts times the published rate. A table
 * that cannot be read prices the run as unknown: the run still finishes, and the reward
 * treats unknown as neutral rather than free (see src/select/reward.ts).
 */
export async function priceTask(modelSpec: string, evidence: EvidenceRecorder): Promise<TaskCost> {
  try {
    const loaded = await loadPricing({
      fetch: (url) => fetch(url, { signal: AbortSignal.timeout(shortlistFetchTimeoutMs) }),
    });
    return costOfTask({ modelSpec, entries: payloadsSince(evidence, 0), pricing: loaded.pricing });
  } catch (cause) {
    return {
      costUsd: null,
      source: "unknown",
      inputTokens: 0,
      outputTokens: 0,
      modelCalls: 0,
      detail: `no pricing table could be read: ${describeError(cause)}`,
    };
  }
}

interface RewardLogInput {
  readonly evidence: EvidenceRecorder;
  readonly home: string;
  readonly task: string;
  readonly modelSpec: string;
  readonly assignment: "calibration" | "competency" | "ucb" | "epsilon" | "pinned";
  readonly ratchet: ReturnType<typeof summarizeRatchet>;
  /** The run's own verdict, so the router is not taught by the gate strip alone. */
  readonly green: boolean;
  readonly changedFiles: number | null;
  readonly latencyMs: number;
  readonly recordedAt: number;
  readonly cost: TaskCost;
  readonly note: (line: string) => void;
}

/**
 * Written twice on purpose: into the session ledger, where it is part of this run's evidence,
 * and into the cross-session routing log, which is the signal the bandit reads. A failure to
 * write the log is reported and not fatal: routing is a hint, and losing one sample must not
 * cost a run that has already finished.
 */
export async function logReward(input: RewardLogInput): Promise<void> {
  const classification = classifyTask(input.task);
  const entry = buildRewardEntry({
    recordedAt: input.recordedAt,
    sessionId: input.evidence.sessionId,
    taskClass: classification.taskClass,
    model: input.modelSpec,
    assignment: input.assignment,
    ratchet: input.ratchet,
    green: input.green,
    changedFiles: input.changedFiles,
    latencyMs: input.latencyMs,
    costUsd: input.cost.costUsd,
    costSource: input.cost.source,
  });

  await input.evidence.record({
    type: "reward",
    actor: "harness",
    provenance: ["tool-output"],
    payload: {
      ...entry,
      taskClassRule: classification.rule,
      costDetail: input.cost.detail,
      costInputTokens: input.cost.inputTokens,
      costOutputTokens: input.cost.outputTokens,
    },
  });

  try {
    const log = await openRoutingLog({ path: defaultRoutingLogPath(input.home) });
    await log.append(entry);
    input.note(`\nrouting reward: ${entry.reward.toFixed(3)} (${entry.rewardReason})`);
  } catch (cause) {
    input.note(`[routing] the reward could not be appended to the log: ${describeError(cause)}`);
  }
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
