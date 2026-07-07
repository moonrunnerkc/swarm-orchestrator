// Exact McNemar test for paired binary outcomes, used by the twin-separation
// measurement: each pair is (fired on the cheat twin, fired on the honest twin).
// Only the discordant pairs carry signal, so the exact two-sided p-value is the
// binomial tail on min(b, c) out of b + c at p = 0.5. Small-n honest: with no
// discordant pairs the p-value is 1 (no evidence of separation), never a divide.

/** The 2x2 paired table plus the exact test result. */
export interface McNemarResult {
  /** b: fired on the cheat twin, not the honest twin (the separation direction). */
  readonly cheatOnly: number;
  /** c: fired on the honest twin, not the cheat twin (the wrong direction). */
  readonly honestOnly: number;
  readonly bothFired: number;
  readonly neitherFired: number;
  /** Discordant pairs = b + c, the only pairs the test uses. */
  readonly discordant: number;
  /** Exact two-sided binomial p-value; 1 when there are no discordant pairs. */
  readonly pValueExact: number;
}

/** n-choose-k as an exact integer product, safe for the small n twin sets use. */
function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const j = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < j; i += 1) {
    result = (result * (n - i)) / (i + 1);
  }
  return Math.round(result);
}

/**
 * Run the exact McNemar test over a set of paired binary outcomes.
 *
 * @param pairs one entry per twin pair: whether the trigger fired on the cheat
 *   twin and on the honest twin.
 * @returns the paired table and the exact two-sided p-value. A run with no
 *   discordant pairs returns p = 1 (nothing to distinguish), never NaN.
 */
export function mcNemarExact(
  pairs: readonly { cheat: boolean; honest: boolean }[],
): McNemarResult {
  let b = 0;
  let c = 0;
  let both = 0;
  let neither = 0;
  for (const p of pairs) {
    if (p.cheat && !p.honest) b += 1;
    else if (!p.cheat && p.honest) c += 1;
    else if (p.cheat && p.honest) both += 1;
    else neither += 1;
  }
  const n = b + c;
  let pValue = 1;
  if (n > 0) {
    const k = Math.min(b, c);
    let tail = 0;
    for (let i = 0; i <= k; i += 1) tail += choose(n, i);
    pValue = Math.min(1, 2 * tail * Math.pow(0.5, n));
  }
  return { cheatOnly: b, honestOnly: c, bothFired: both, neitherFired: neither, discordant: n, pValueExact: pValue };
}

/**
 * Paired separation for one trigger: the difference between the fire rate on the
 * cheat twins and the fire rate on the honest twins, over the same pairs.
 * Positive means the trigger discriminates the cheat from its honest twin.
 *
 * @param pairs the paired outcomes.
 * @returns fire rates and their difference; all zero for an empty set.
 */
export function pairedSeparation(
  pairs: readonly { cheat: boolean; honest: boolean }[],
): { n: number; cheatFireRate: number; honestFireRate: number; separation: number } {
  const n = pairs.length;
  if (n === 0) return { n: 0, cheatFireRate: 0, honestFireRate: 0, separation: 0 };
  const cheatFires = pairs.filter((p) => p.cheat).length;
  const honestFires = pairs.filter((p) => p.honest).length;
  const cheatFireRate = cheatFires / n;
  const honestFireRate = honestFires / n;
  return { n, cheatFireRate, honestFireRate, separation: cheatFireRate - honestFireRate };
}
