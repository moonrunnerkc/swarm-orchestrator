import type { VerifyResult } from "swarm-verify";

/**
 * What the model reads after a verification: each requirement's status and why, with what each
 * failing piece of evidence observed, then the verifier's reasons and the failing output.
 * Statuses are the verifier's; nothing here judges.
 */
export function feedbackOf(result: VerifyResult): string {
  const requirements = result.requirements.flatMap((one) => {
    const why = one.limitation === null ? "" : `: ${one.limitation}`;
    const next = one.nextAction === null ? "" : ` (next: ${one.nextAction})`;
    const observed = one.evidence
      .filter((ref) => (ref.outcome === "fail" || ref.outcome === "failing") && ref.detail)
      .map((ref) => `  observed, ${ref.ref}: ${ref.detail}`);
    return [`${one.id} ${one.status}${why}${next}`, ...observed];
  });
  return [
    `state: ${result.state}`,
    ...requirements,
    `regression: ${result.regression.status}`,
    ...result.reasons,
    ...(result.failureOutput.length > 0 ? ["", result.failureOutput] : []),
  ].join("\n");
}
