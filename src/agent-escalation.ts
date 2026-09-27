import { z } from "zod";
import type { ModelClient } from "./core/model-client.ts";
import { asJsonValue } from "./evidence/canonical-json.ts";
import type { EvidenceRecorder } from "./evidence/session.ts";
import type { GateCycle } from "./gates/gate-runner.ts";
import {
  classifyRepair,
  decideEscalation,
  type EscalationSettings,
} from "./gates/repair-policy.ts";

export const escalationEventSchema = z.strictObject({
  rule: z.literal("capability-escalation-v1"),
  phase: z.enum(["intent", "completed"]),
  requestedModel: z.string(),
  effectiveModel: z.string(),
  count: z.literal(1),
  baseCommit: z.string(),
  remainingAllowance: z.number(),
  remainingMs: z.number(),
  signature: z.string(),
  unknownUsage: z.boolean(),
});

/** One owned escalation lifecycle; unresolved intents require reconciliation rather than replay. */
export function createEscalationController(options: {
  settings: EscalationSettings;
  target: ModelClient;
  evidence: EvidenceRecorder;
  baseCommit: string;
  previousCount?: number;
}) {
  let count = options.previousCount ?? 0;
  let previousSignature: string | null = null;
  return {
    async select(
      cycle: GateCycle,
      budget: { remainingTokens: number; remainingMs: number; unknownUsage: boolean },
    ): Promise<ModelClient | null> {
      const failure = classifyRepair(cycle);
      const decision = decideEscalation({
        ...budget,
        settings: options.settings,
        classification: failure.kind,
        signature: failure.signature,
        previousSignature,
        count,
      });
      previousSignature = failure.signature;
      if (decision === "stop")
        throw new Error(
          `repair stopped: ${failure.remedy}; preserve remaining final-verification budget`,
        );
      if (decision !== "escalate") return null;
      count = 1;
      await options.evidence.record({
        type: "session-budget",
        actor: "harness",
        provenance: ["user", "tool-output"],
        payload: asJsonValue(
          escalationEventSchema.parse({
            rule: "capability-escalation-v1",
            phase: "intent",
            count,
            requestedModel: options.settings.target,
            effectiveModel: options.target.modelId,
            baseCommit: options.baseCommit,
            remainingAllowance: budget.remainingTokens,
            remainingMs: budget.remainingMs,
            unknownUsage: budget.unknownUsage,
            signature: failure.signature,
          }),
        ),
      });
      return options.target;
    },
    async complete(unknownUsage: boolean): Promise<void> {
      const intent = [...options.evidence.records()]
        .reverse()
        .find(
          (entry) =>
            entry.type === "session-budget" &&
            (options.evidence.payloads().get(entry.payloadDigest) as { rule?: string })?.rule ===
              "capability-escalation-v1",
        );
      if (!intent) throw new Error("escalation completion has no intent");
      const value = escalationEventSchema.parse(
        options.evidence.payloads().get(intent.payloadDigest),
      );
      await options.evidence.record({
        type: "session-budget",
        actor: "harness",
        provenance: ["tool-output"],
        payload: asJsonValue({ ...value, phase: "completed", unknownUsage }),
      });
    },
  };
}
