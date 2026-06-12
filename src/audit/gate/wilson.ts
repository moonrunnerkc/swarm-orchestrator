// Wilson score interval lower bound for a binomial proportion at 95%
// confidence. The block gate keys its eligibility on this bound, not on point
// precision, so a trigger that fired a handful of times at precision 1.0 is not
// promoted on luck: the bound stays low until there are enough confirmations.
//
// This deliberately mirrors the bound the detector promotion gate uses
// (scripts/promotions/compute-promotions.ts). It is kept as its own small
// module here so the block path does not couple to the frozen promotions path,
// which CI guards for byte-exact recompute.

/**
 * Wilson score interval lower bound at 95% confidence.
 *
 * @param successes number of confirmed true positives
 * @param trials total firings (true positives plus false positives)
 * @returns the lower bound in [0, 1]; 0 when there were no trials
 */
export function wilsonLowerBound(successes: number, trials: number): number {
  if (trials === 0) return 0;
  const z = 1.96;
  const phat = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const center = phat + z2 / (2 * trials);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * trials)) / trials);
  return Math.max(0, (center - margin) / denom);
}

/** A two-sided Wilson score interval at 95% confidence. */
export interface WilsonInterval {
  point: number;
  lower: number;
  upper: number;
}

/**
 * Two-sided Wilson score interval at 95% confidence. Shares the lower-bound
 * math with {@link wilsonLowerBound}; the upper bound flips the margin sign.
 * Used by the outcome-grounded scorer to report precision/recall with bounds
 * at both PR and finding level.
 *
 * @param successes number of successes (e.g. true positives)
 * @param trials total trials; an interval of all-zeros when 0
 * @returns the point estimate and both 95% bounds in [0, 1]
 */
export function wilsonInterval(successes: number, trials: number): WilsonInterval {
  if (trials === 0) return { point: 0, lower: 0, upper: 0 };
  const z = 1.96;
  const phat = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const center = phat + z2 / (2 * trials);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * trials)) / trials);
  return {
    point: phat,
    lower: Math.max(0, (center - margin) / denom),
    upper: Math.min(1, (center + margin) / denom),
  };
}
