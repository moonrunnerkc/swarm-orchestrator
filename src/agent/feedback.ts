import type { VerifyResult } from "swarm-verify";

/**
 * What the model reads after a verification: each requirement's status and why, then the
 * verifier's reasons and the failing output. Statuses are the verifier's; nothing here judges.
 */
export function feedbackOf(result: VerifyResult): string {
  const requirements = result.requirements.map((one) => {
    const why = one.limitation === null ? "" : `: ${one.limitation}`;
    const next = one.nextAction === null ? "" : ` (next: ${one.nextAction})`;
    return `${one.id} ${one.status}${why}${next}`;
  });
  return [
    `state: ${result.state}`,
    ...requirements,
    `regression: ${result.regression.status}`,
    ...result.reasons,
    ...(result.failureOutput.length > 0 ? ["", result.failureOutput] : []),
  ].join("\n");
}
