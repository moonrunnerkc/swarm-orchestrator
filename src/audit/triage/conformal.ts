// Conformal selective wrapper. The ranker emits a score per PR; this picks a
// score threshold on a held-out calibration split such that any PR actually
// flagged (score at or above the threshold) meets a target precision with a
// finite-sample guarantee, and everything below abstains. The guarantee is a
// one-sided Clopper-Pearson lower confidence bound on the flagged-set
// precision: distribution-free and exact for the binomial, the selective-
// prediction analogue of split conformal. The threshold is the lowest one
// (maximum coverage) whose calibration precision lower bound clears the target.
//
// Pure: the exact bound uses the regularized incomplete beta and its inverse,
// implemented here so there is no dependency and the result replays.

import type { ScoredInstance } from './metrics';

const GAMMA_C = [
  76.18009172947146, -86.50532032941678, 24.01409824083091, -1.231739572450155,
  0.1208650973866179e-2, -0.5395239384953e-5,
];

/** Natural log of the gamma function (Lanczos approximation). */
function lnGamma(x: number): number {
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1 + 0.190015e-9;
  for (let j = 0; j < 6; j += 1) {
    y += 1;
    ser += GAMMA_C[j] / y;
  }
  return -tmp + Math.log((2.5066282746310007 * ser) / x);
}

/** Continued fraction for the incomplete beta function (Numerical Recipes). */
function betacf(a: number, b: number, x: number): number {
  const fpmin = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < fpmin) d = fpmin;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}

/** Regularized incomplete beta function I_x(a, b) in [0, 1]. */
export function regularizedIncompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/**
 * One-sided Clopper-Pearson lower confidence bound on a binomial proportion:
 * the alpha-quantile of Beta(k, n - k + 1). Found by bisection on the
 * regularized incomplete beta, which is monotone in p.
 *
 * @param k successes (true positives among flagged)
 * @param n trials (flagged count)
 * @param alpha one-sided error, e.g. 0.05 for 95% confidence
 */
export function clopperPearsonLower(k: number, n: number, alpha: number): number {
  if (n === 0) return 0;
  if (k === 0) return 0;
  if (k === n) return Math.pow(alpha, 1 / n);
  const a = k;
  const b = n - k + 1;
  let lo = 0;
  let hi = 1;
  for (let iter = 0; iter < 100; iter += 1) {
    const mid = (lo + hi) / 2;
    if (regularizedIncompleteBeta(a, b, mid) > alpha) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export interface ConformalResult {
  /** Score at or above which a PR is flagged. Infinity means abstain on all. */
  readonly threshold: number;
  /** Fraction of calibration instances at or above the threshold. */
  readonly calibrationCoverage: number;
  /** Point precision on the flagged calibration instances. */
  readonly calibrationPrecision: number;
  /** Clopper-Pearson lower bound on that precision; the guarantee. */
  readonly calibrationPrecisionLower: number;
  /** Flagged count and true positives among them on calibration. */
  readonly flagged: number;
  readonly truePositives: number;
}

/**
 * Choose the lowest score threshold (maximum coverage) whose flagged-set
 * precision lower bound clears the target on the calibration split. If no
 * threshold qualifies, abstain on everything (threshold Infinity).
 *
 * @param calibration scored, labeled calibration instances
 * @param targetPrecision the precision the flagged set must guarantee
 * @param alpha one-sided confidence level for the lower bound
 */
export function selectThreshold(
  calibration: readonly ScoredInstance[],
  targetPrecision: number,
  alpha: number,
): ConformalResult {
  const candidates = [...new Set(calibration.map((c) => c.score))].sort((a, b) => b - a);
  let best: ConformalResult | null = null;
  for (const tau of candidates) {
    let flagged = 0;
    let tp = 0;
    for (const c of calibration) {
      if (c.score >= tau) {
        flagged += 1;
        if (c.label === 1) tp += 1;
      }
    }
    const lower = clopperPearsonLower(tp, flagged, alpha);
    if (lower >= targetPrecision) {
      // candidates descend, so each qualifying tau has coverage >= the last:
      // keep the most recent (lowest tau so far) as the max-coverage choice.
      best = {
        threshold: tau,
        calibrationCoverage: flagged / calibration.length,
        calibrationPrecision: flagged === 0 ? 0 : tp / flagged,
        calibrationPrecisionLower: lower,
        flagged,
        truePositives: tp,
      };
    }
  }
  return (
    best ?? {
      threshold: Number.POSITIVE_INFINITY,
      calibrationCoverage: 0,
      calibrationPrecision: 0,
      calibrationPrecisionLower: 0,
      flagged: 0,
      truePositives: 0,
    }
  );
}
