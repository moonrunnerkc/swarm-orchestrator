import { z } from "zod";

const effect = z.object({
  phase: z.enum(["intent", "completed"]),
  contractDigest: z.string().min(1),
  checkId: z.string().min(1),
  tree: z.string().min(1),
});
export class GoalEffectReconciliationError extends Error {
  constructor(detail: string) {
    super(
      `acceptance check has an unresolved effect: ${detail}; reconcile owned processes and source before resuming`,
    );
    this.name = "GoalEffectReconciliationError";
  }
}

/** Earlier formats have no phase; new effects must have a matching, ordered completion. */
export function assertGoalEffectsSettled(
  records: readonly { type: string; payloadDigest: string }[],
  payloads: ReadonlyMap<string, unknown>,
): void {
  const pending = new Set<string>();
  for (const record of records) {
    if (record.type !== "goal-check") continue;
    const value = payloads.get(record.payloadDigest);
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, "phase")) continue;
    const parsed = effect.parse(value);
    const identity = JSON.stringify([parsed.contractDigest, parsed.tree, parsed.checkId]);
    if (parsed.phase === "intent") {
      if (pending.has(identity)) throw new GoalEffectReconciliationError("duplicate check intent");
      pending.add(identity);
    } else {
      if (!pending.delete(identity))
        throw new GoalEffectReconciliationError("completion without intent");
    }
  }
  if (pending.size) throw new GoalEffectReconciliationError([...pending].join(", "));
}
