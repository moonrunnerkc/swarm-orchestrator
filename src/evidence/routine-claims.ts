import { z } from "zod";
import { recordKindOf } from "./record-kind.ts";
import type { EvidenceRecorder } from "./session.ts";

const observedGate = z.object({ status: z.enum(["passed", "failed", "not-applicable"]) });
const observedLifecycle = z.object({ stopReason: z.string().min(1) });
const observedBudget = z.object({
  phase: z.literal("settled"),
  tokensUsed: z.number().int().nonnegative(),
  steps: z.number().int().nonnegative(),
});

/** Receipts state what was measured, including failures. They never replace an assessment. */
export async function recordRoutineClaims(evidence: EvidenceRecorder, digests: readonly string[]) {
  for (const digest of new Set(digests)) {
    const record = evidence.records().find((entry) => entry.payloadDigest === digest);
    if (record?.actor !== "harness") continue;
    const payload = evidence.payloads().get(digest);
    let predicate: string;
    if (record.type === "gate-run") {
      const gate = observedGate.parse(payload);
      predicate = `status == ${JSON.stringify(gate.status)}`;
    } else if (record.type === "session-stopped") {
      predicate = `stopReason == ${JSON.stringify(observedLifecycle.parse(payload).stopReason)}`;
    } else if (record.type === "session-budget") {
      const budget = observedBudget.safeParse(payload);
      if (!budget.success) continue;
      predicate = `tokensUsed == ${budget.data.tokensUsed} && steps == ${budget.data.steps}`;
    } else continue;
    if (payload === undefined) throw new Error(`routine fact has no payload: ${digest}`);
    await evidence.submitClaim(
      { predicate, record: digest, recordKind: recordKindOf(record.type, payload), narrative: "" },
      "harness",
    );
  }
}
