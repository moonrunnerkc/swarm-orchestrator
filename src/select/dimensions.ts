/**
 * Section 3.9's scoring dimensions, defined before anything was built and never collapsed to
 * one number. Two of them are costs and four are capabilities, which is exactly why a single
 * score would have to invent an exchange rate nobody measured.
 */
export const calibrationDimensions = [
  "tool-call-validity",
  "patch-apply",
  "gate-pass",
  "tokens-per-second",
  "time-to-first-token",
  "peak-memory",
] as const;

export type CalibrationDimension = (typeof calibrationDimensions)[number];

export interface DimensionSpec {
  readonly id: CalibrationDimension;
  readonly label: string;
  readonly unit: string;
  readonly better: "higher" | "lower";
  /**
   * The floor a model has to clear on this dimension to be usable at all, or null when the
   * dimension only ranks. A guess to be tuned against real runs, not a measured constant.
   */
  readonly viableAt: number | null;
}

export const dimensionSpecs: readonly DimensionSpec[] = [
  {
    id: "tool-call-validity",
    label: "tool calls the chokepoint could act on",
    unit: "share",
    better: "higher",
    viableAt: 0.8,
  },
  {
    id: "patch-apply",
    label: "writes that applied",
    unit: "share",
    better: "higher",
    viableAt: 0.5,
  },
  {
    id: "gate-pass",
    label: "cases whose gate went green",
    unit: "share",
    better: "higher",
    viableAt: null,
  },
  {
    id: "tokens-per-second",
    label: "output tokens per second",
    unit: "tokens/s",
    better: "higher",
    viableAt: null,
  },
  {
    id: "time-to-first-token",
    label: "time to first token",
    unit: "ms",
    better: "lower",
    viableAt: null,
  },
  {
    id: "peak-memory",
    label: "peak resident memory",
    unit: "bytes",
    better: "lower",
    viableAt: null,
  },
];

export interface Distribution {
  readonly samples: number;
  /** Repeats that produced no value here, counted rather than folded in as a zero. */
  readonly unmeasured: number;
  readonly min: number | null;
  readonly median: number | null;
  readonly max: number | null;
  readonly mean: number | null;
  /** Population standard deviation across repeats: the variance a report has to show. */
  readonly deviation: number | null;
  readonly values: readonly number[];
}

/**
 * The shape of one dimension across repeats. Averages alone hide the model that solves a case
 * twice in three tries, so the spread travels with the middle everywhere it goes.
 */
export function distributionOf(values: readonly (number | null)[]): Distribution {
  const measured = values.filter((value): value is number => value !== null);
  const unmeasured = values.length - measured.length;

  if (measured.length === 0) {
    return {
      samples: 0,
      unmeasured,
      min: null,
      median: null,
      max: null,
      mean: null,
      deviation: null,
      values: [],
    };
  }

  const sorted = [...measured].sort((left, right) => left - right);
  const mean = measured.reduce((sum, value) => sum + value, 0) / measured.length;
  const variance = measured.reduce((sum, value) => sum + (value - mean) ** 2, 0) / measured.length;

  return {
    samples: measured.length,
    unmeasured,
    min: sorted[0] ?? null,
    median: medianOf(sorted),
    max: sorted[sorted.length - 1] ?? null,
    mean,
    deviation: Math.sqrt(variance),
    values: measured,
  };
}

function medianOf(sorted: readonly number[]): number | null {
  if (sorted.length === 0) {
    return null;
  }
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? null;
  }
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
