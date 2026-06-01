// Shared metric arithmetic for the audit benchmark harnesses. Kept tiny
// and dependency-free so the baseline, oracle, and A/B scripts all report
// precision / recall / latency the same way and a reviewer can audit one
// definition instead of four copies.

export interface Counts {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

export function emptyCounts(): Counts {
  return { tp: 0, fp: 0, fn: 0, tn: 0 };
}

export function divide(num: number, den: number): number {
  return den === 0 ? 0 : num / den;
}

export function precision(c: Counts): number {
  return divide(c.tp, c.tp + c.fp);
}

export function recall(c: Counts): number {
  return divide(c.tp, c.tp + c.fn);
}

export function f1(c: Counts): number {
  const p = precision(c);
  const r = recall(c);
  if (p + r === 0) return 0;
  return (2 * p * r) / (p + r);
}

/**
 * Round to a fixed number of decimals so JSON output is byte-stable
 * across runs (floating-point division can differ in the last bit
 * depending on evaluation order). Four decimals is enough resolution for
 * a recall delta and avoids spurious diffs.
 */
export function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * p95 of a latency sample, nearest-rank method. Returns 0 for an empty
 * sample. Input is not mutated.
 */
export function p95(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil(0.95 * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] ?? 0;
}

export function mean(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) sum += s;
  return sum / samples.length;
}
