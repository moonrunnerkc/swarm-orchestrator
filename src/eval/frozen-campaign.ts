import type { EvidenceRecorder } from "../evidence/session.ts";
import { type CampaignOutcome, openCampaign } from "./campaign-record.ts";
import { unobservedGoalMetrics } from "./goal-observation.ts";
import { freezeProtocol } from "./protocol.ts";

export interface CampaignArmExecutor {
  readonly id: string;
  readonly implementationDigest: string;
  readonly run: (execution: {
    caseId: string;
    repository: string;
    armId: string;
    seed: number;
    executionId: string;
    budget: { tokens: number; wallMs: number };
    signal: AbortSignal;
  }) => Promise<Omit<CampaignOutcome, "executionId">>;
}

/** Dispatch only the implementations admitted by the frozen protocol, preserving failures. */
export async function runFrozenCampaign(options: {
  protocol: unknown;
  resume?: boolean;
  evidence: EvidenceRecorder;
  executors: readonly CampaignArmExecutor[];
  now: () => number;
  signal: AbortSignal;
  health: () => Promise<{
    healthy: boolean;
    processes: number;
    memoryBytes: number;
    endpoint: "available" | "unavailable" | "not-required";
  }>;
  exportEvidence: () => Promise<void>;
}) {
  const { protocol } = freezeProtocol(options.protocol);
  const executors = new Map(options.executors.map((executor) => [executor.id, executor]));
  if (executors.size !== options.executors.length) throw new Error("duplicate arm implementation");
  for (const arm of protocol.arms)
    if (executors.get(arm.id)?.implementationDigest !== arm.implementationDigest)
      throw new Error(`arm ${arm.id} has no matching frozen implementation`);
  const campaign = await openCampaign(protocol, options.evidence, {
    resume: options.resume === true,
  });
  const health = async (phase: string, executionId: string) => {
    try {
      return await options.health();
    } catch (cause) {
      await options.evidence.record({
        type: "campaign-observation",
        actor: "harness",
        provenance: ["tool-output"],
        payload: {
          phase,
          executionId,
          available: false,
          detail: cause instanceof Error ? cause.message : String(cause),
        },
      });
      return null;
    }
  };
  try {
    if (campaign.unresolved().length > 0)
      throw new Error(
        `unsettled campaign launches require reconciliation: ${campaign.unresolved().join(", ")}`,
      );
    let stopped: string | null = null;
    for (const execution of campaign.schedule) {
      if (campaign.completed(execution.executionId)) continue;
      const started = options.now();
      if (options.signal.aborted) {
        stopped = "campaign cancellation requested";
        break;
      }
      const before = await health("health-before-unavailable", execution.executionId);
      if (before === null) {
        stopped = "pre-launch health observation unavailable";
        break;
      }
      await options.evidence.record({
        type: "campaign-observation",
        actor: "harness",
        provenance: ["tool-output"],
        payload: { phase: "health-before", executionId: execution.executionId, ...before },
      });
      if (!before.healthy || before.endpoint === "unavailable") {
        stopped = "pre-launch resources or required endpoint unavailable";
        break;
      }
      await campaign.launch(execution.executionId);
      let outcome: Omit<CampaignOutcome, "executionId">;
      try {
        const executor = executors.get(execution.armId);
        if (executor === undefined) throw new Error(`frozen arm ${execution.armId} is unavailable`);
        outcome = await executor.run({
          ...execution,
          budget: { ...protocol.budgets },
          signal: options.signal,
        });
      } catch (cause) {
        await options.evidence.record({
          type: "campaign-observation",
          actor: "harness",
          provenance: ["tool-output"],
          payload: {
            phase: "dispatch-failure",
            executionId: execution.executionId,
            detail: cause instanceof Error ? cause.message : String(cause),
          },
        });
        outcome = {
          ...(protocol.version === 2
            ? {
                goal: unobservedGoalMetrics(
                  protocol.cases.find((goal) => goal.id === execution.caseId)?.requirementIds
                    .length ?? 1,
                  options.signal.aborted ? "cancelled" : "crashed",
                  cause instanceof Error ? cause.message : String(cause),
                ),
              }
            : {}),
          status: options.signal.aborted ? "cancelled" : "crashed",
          certified: null,
          heldBackAccepted: null,
          costUsd: null,
          latencyMs: Math.max(0, options.now() - started),
          evidenceDigest: null,
          cleanup: "unmeasured",
        };
      }
      const after = await health("health-after-unavailable", execution.executionId);
      await options.evidence.record({
        type: "campaign-observation",
        actor: "harness",
        provenance: ["tool-output"],
        payload: { phase: "health-after", executionId: execution.executionId, ...after },
      });
      await campaign.settle({
        ...outcome,
        executionId: execution.executionId,
        ...(protocol.version === 2 ? { latencyMs: Math.max(0, options.now() - started) } : {}),
        ...(!after?.healthy ? { status: "infrastructure-failure", cleanup: "failed" } : {}),
      });
      if (!after?.healthy || outcome.cleanup !== "confirmed") {
        stopped = "post-launch health or owned-resource cleanup not confirmed";
        break;
      }
    }
    if (stopped !== null && protocol.version === 2) await campaign.deferRemaining(stopped);
    return campaign.report();
  } finally {
    await options.exportEvidence();
  }
}
