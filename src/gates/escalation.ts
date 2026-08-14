import { z } from "zod";

/**
 * What a human gets when the loop stops. The point is to name one gate and one reason,
 * not to hand over a pile of attempts: the attempt history is in the bundle, and this is
 * the sentence that says where to look first.
 */

export const attemptSummarySchema = z.object({
  attempt: z.number().int().positive(),
  ratchetAccepted: z.boolean(),
  ratchetDetail: z.string(),
  blockingFailures: z.array(z.string()),
  gateRecords: z.array(z.string()),
});

export type AttemptSummary = z.infer<typeof attemptSummarySchema>;

export const escalationSchema = z.object({
  gateId: z.string(),
  title: z.string(),
  reason: z.string(),
  attemptsUsed: z.number().int().nonnegative(),
  /** Zero when the caller offered no retries at all, which is a report rather than a loop. */
  cap: z.number().int().nonnegative(),
  attemptsRejectedByRatchet: z.number().int().nonnegative(),
  lastGateRecord: z.string(),
  history: z.array(attemptSummarySchema),
});

export type EscalationPayload = z.infer<typeof escalationSchema>;

export function describeEscalation(escalation: EscalationPayload): string {
  const lines = [
    `Escalating after ${escalation.attemptsUsed} of ${escalation.cap} attempts.`,
    "",
    `Gate: ${escalation.gateId} (${escalation.title})`,
    `Why: ${escalation.reason}`,
    `Its last run is ledger record ${escalation.lastGateRecord}.`,
  ];

  if (escalation.attemptsRejectedByRatchet > 0) {
    lines.push(
      "",
      `${escalation.attemptsRejectedByRatchet} of those attempts were rejected by the ratchet ` +
        "rather than failing outright: they traded a measured number the wrong way, so the " +
        "workspace was returned to the last accepted state instead of walking further.",
    );
  }

  lines.push("", "Attempts:");
  for (const attempt of escalation.history) {
    lines.push(
      `  ${attempt.attempt}. ${attempt.ratchetAccepted ? "accepted" : "REJECTED"} - ${attempt.ratchetDetail}`,
      `     still failing: ${attempt.blockingFailures.join(", ") || "nothing"}`,
    );
  }

  return lines.join("\n");
}
