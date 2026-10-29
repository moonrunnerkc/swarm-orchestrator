/** Wilson score interval for k successes in n trials, at 95%. Null where n is 0. */
export function wilson(k, n, z = 1.959964) {
  if (n === 0) return null;
  const p = k / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/**
 * Exact two-sided McNemar test: the discordant pairs b (first arm only) and c (second arm only)
 * under Binomial(b + c, 1/2). A p-value of 1 where there are no discordant pairs.
 */
export function mcnemar(b, c) {
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  let tail = 0;
  let term = 0.5 ** n;
  for (let i = 0; i <= k; i += 1) {
    tail += term;
    term = (term * (n - i)) / (i + 1);
  }
  return Math.min(1, 2 * tail);
}
