// Compute the per-detector promotion record at
// `benchmarks/real-corpus/promotions.json` so the gate-eligible list is
// auditable.
//
// Reads the most recent real-corpus scores snapshot
// (`benchmarks/real-corpus/scores/latest.json` by default) and emits
// one row per detector with:
//
//   - the measured F1, precision, recall, firing count
//   - the proposed status: `gate-eligible` (F1 ≥ threshold),
//     `advisory-only` (fired but below threshold), or `unmeasured`
//     (did not fire on the sample)
//   - the threshold the gate decision was made against
//   - the corpus identifier the numbers came from
//
// Run this after the labels-v2 corpus is final and re-ran through the
// scorer; the downstream consumer is the gate-mode CLI and the
// README's "what gates today" table.

import * as fs from 'fs';
import * as path from 'path';

interface ScoresSnapshot {
  generatedAt: string;
  detectorVersions: Record<string, string>;
  perDetector: Array<{
    detector: string;
    truePositive: number;
    falsePositive: number;
    trueNegative: number;
    falseNegative: number;
    precision: number;
    recall: number;
    f1: number;
  }>;
}

export type PromotionStatus = 'gate-eligible' | 'advisory-only' | 'unmeasured';

// The semantic categories the judge-primary path raises. They have no
// structural detector and so no detector-level precision row; their
// promotion is governed separately, below.
const JUDGE_PRIMARY_CATEGORIES = ['goal-not-fixed', 'cheat-mock-mutation'] as const;

// A judge-primary category may gate (block) only when a consumer has
// measured the path on their own merged-PR window and the false-positive
// rate is within this many percentage points of their pre-upgrade
// baseline. Absent such a measurement the category ships advisory (warn).
// The bar is documented in docs/audit/methodology.md.
const MAX_FP_DELTA_PP_FOR_BLOCK = 2;
const MIN_WINDOW_PR_COUNT_FOR_BLOCK = 100;

// A per-consumer false-positive measurement that justifies promoting a
// judge-primary category from advisory to blocking. Recorded out-of-band
// (a consumer measures their own repo) and read from the measurements
// file; absent by default, which keeps every category advisory.
export interface JudgePrimaryMeasurement {
  /** FP rate (percentage points) of the judge-primary path on the
   *  consumer's merged-PR window. */
  fpRatePostPp: number;
  /** FP rate (percentage points) of the pre-upgrade auditor on the same
   *  window, for the delta the bar is expressed against. */
  fpRateBaselinePp: number;
  /** Number of merged PRs in the measured window. */
  windowPrCount: number;
  /** Where the measurement came from (free text, for auditability). */
  source: string;
}

export interface JudgePrimaryCategoryPolicy {
  category: (typeof JUDGE_PRIMARY_CATEGORIES)[number];
  block: boolean;
  warn: boolean;
  measurement: JudgePrimaryMeasurement | null;
  reason: string;
}

export interface JudgePrimaryPolicy {
  /** The default for a category with no qualifying measurement on file. */
  defaultBlock: boolean;
  maxFpDeltaPpForBlock: number;
  minWindowPrCountForBlock: number;
  categories: JudgePrimaryCategoryPolicy[];
}

export interface PromotionRow {
  detector: string;
  detectorVersion: string;
  status: PromotionStatus;
  f1: number;
  precision: number;
  recall: number;
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  firingCount: number;
  reason: string;
}

export interface PromotionsOutput {
  generatedAt: string;
  computedBy: string;
  scoresFile: string;
  scoresGeneratedAt: string;
  gatePrecisionThreshold: number;
  minTruePositiveForGate: number;
  rows: PromotionRow[];
  gateEligibleDetectors: string[];
  advisoryOnlyDetectors: string[];
  unmeasuredDetectors: string[];
  judgePrimary: JudgePrimaryPolicy;
}

interface Args {
  scoresFile: string;
  out: string;
  gatePrecision: number;
  minTruePositive: number;
  /** Optional per-consumer FP measurements that can promote a
   *  judge-primary category to blocking. Absent by default. */
  measurementsFile?: string;
}

// A detector may emit a blocking finding only when it clears the gate.
// The gate is precision-first, not F1: a reviewer reads "block" as "act
// on this now", so the cost of a false block is high and recall is
// secondary. F1 hid that by trading the two off. The Wilson lower bound
// keeps a detector that fired a handful of times from being promoted on
// luck: it must be precise AND have enough firings for the precision to
// mean something.
//
// Detectors below the gate are advisory-only: they still run and still
// surface findings, but their findings are capped to advisory severity.
// Nothing is silenced, so recall is unchanged; the gate governs blocking
// only.
const DEFAULT_GATE_PRECISION = 0.9;
const DEFAULT_MIN_TRUE_POSITIVE = 5;

function parseArgs(argv: string[]): Args {
  let scoresFile = path.join('benchmarks', 'real-corpus', 'scores', 'latest.json');
  let out = path.join('benchmarks', 'real-corpus', 'promotions.json');
  let gatePrecision = DEFAULT_GATE_PRECISION;
  let minTruePositive = DEFAULT_MIN_TRUE_POSITIVE;
  let measurementsFile: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--scores' && argv[i + 1] !== undefined) {
      scoresFile = argv[i + 1]!;
      i += 1;
    } else if (arg === '--out' && argv[i + 1] !== undefined) {
      out = argv[i + 1]!;
      i += 1;
    } else if (arg === '--gate-precision' && argv[i + 1] !== undefined) {
      gatePrecision = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--min-true-positive' && argv[i + 1] !== undefined) {
      minTruePositive = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--measurements' && argv[i + 1] !== undefined) {
      measurementsFile = argv[i + 1]!;
      i += 1;
    }
  }
  const out2: Args = { scoresFile, out, gatePrecision, minTruePositive };
  if (measurementsFile !== undefined) out2.measurementsFile = measurementsFile;
  return out2;
}

// The default measurements location. A consumer drops their measured FP
// numbers here to promote a judge-primary category; absent in this repo,
// which is why both categories ship advisory in the committed policy.
const DEFAULT_MEASUREMENTS_FILE = path.join(
  'benchmarks',
  'real-corpus',
  'judge-primary-measurements.json',
);

function loadMeasurements(
  file: string | undefined,
): Partial<Record<(typeof JUDGE_PRIMARY_CATEGORIES)[number], JudgePrimaryMeasurement>> {
  const resolved = file ?? DEFAULT_MEASUREMENTS_FILE;
  if (!fs.existsSync(resolved)) return {};
  const raw = JSON.parse(fs.readFileSync(resolved, 'utf8')) as Record<
    string,
    JudgePrimaryMeasurement
  >;
  const out: Partial<Record<(typeof JUDGE_PRIMARY_CATEGORIES)[number], JudgePrimaryMeasurement>> =
    {};
  for (const category of JUDGE_PRIMARY_CATEGORIES) {
    const m = raw[category];
    if (m !== undefined) out[category] = m;
  }
  return out;
}

// A judge-primary category gates only with a measurement that clears the
// bar: enough PRs in the window and an FP delta within the ceiling. Any
// other case (no measurement, too few PRs, delta over the ceiling) is
// advisory. The decision is a pure function of the measurements file, so
// the recompute in check-policy reproduces it exactly.
function computeJudgePrimaryPolicy(
  measurements: Partial<
    Record<(typeof JUDGE_PRIMARY_CATEGORIES)[number], JudgePrimaryMeasurement>
  >,
): JudgePrimaryPolicy {
  const categories: JudgePrimaryCategoryPolicy[] = JUDGE_PRIMARY_CATEGORIES.map((category) => {
    const m = measurements[category] ?? null;
    if (m === null) {
      return {
        category,
        block: false,
        warn: true,
        measurement: null,
        reason:
          'advisory by default: no per-consumer false-positive measurement on file. ' +
          `Provide one in ${DEFAULT_MEASUREMENTS_FILE} clearing the bar ` +
          `(FP delta <= ${MAX_FP_DELTA_PP_FOR_BLOCK}pp over baseline, ` +
          `window >= ${MIN_WINDOW_PR_COUNT_FOR_BLOCK} PRs) to promote to block.`,
      };
    }
    const deltaPp = m.fpRatePostPp - m.fpRateBaselinePp;
    const clears =
      deltaPp <= MAX_FP_DELTA_PP_FOR_BLOCK && m.windowPrCount >= MIN_WINDOW_PR_COUNT_FOR_BLOCK;
    return {
      category,
      block: clears,
      warn: !clears,
      measurement: m,
      reason: clears
        ? `block-eligible: FP delta ${deltaPp.toFixed(2)}pp over baseline on ` +
          `${m.windowPrCount} PRs clears the bar (delta <= ${MAX_FP_DELTA_PP_FOR_BLOCK}pp, ` +
          `window >= ${MIN_WINDOW_PR_COUNT_FOR_BLOCK}). Source: ${m.source}`
        : `advisory: measurement on file does not clear the bar (FP delta ${deltaPp.toFixed(2)}pp ` +
          `over baseline on ${m.windowPrCount} PRs; need delta <= ${MAX_FP_DELTA_PP_FOR_BLOCK}pp ` +
          `and window >= ${MIN_WINDOW_PR_COUNT_FOR_BLOCK}). Source: ${m.source}`,
    };
  });
  return {
    defaultBlock: false,
    maxFpDeltaPpForBlock: MAX_FP_DELTA_PP_FOR_BLOCK,
    minWindowPrCountForBlock: MIN_WINDOW_PR_COUNT_FOR_BLOCK,
    categories,
  };
}

/**
 * Wilson score interval lower bound for a binomial proportion at 95%
 * confidence. `successes` true positives out of `trials` firings. Used
 * so a detector that fired 3 times at precision 1.0 is not treated the
 * same as one that fired 200 times at precision 1.0.
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

export function computePromotions(args: Args): PromotionsOutput {
  const text = fs.readFileSync(args.scoresFile, 'utf8');
  const scores = JSON.parse(text) as ScoresSnapshot;
  const rows: PromotionRow[] = scores.perDetector.map((row) => {
    const firingCount = row.truePositive + row.falsePositive;
    const base = {
      detector: row.detector,
      detectorVersion: scores.detectorVersions[row.detector] ?? 'unknown',
      f1: row.f1,
      precision: row.precision,
      recall: row.recall,
      truePositive: row.truePositive,
      falsePositive: row.falsePositive,
      trueNegative: row.trueNegative,
      falseNegative: row.falseNegative,
      firingCount,
    };
    if (firingCount === 0 && row.falseNegative === 0) {
      return {
        ...base,
        status: 'unmeasured' as PromotionStatus,
        reason: 'did not fire and no broken-labeled targets in the sample',
      };
    }
    const lower = wilsonLowerBound(row.truePositive, firingCount);
    const clearsGate =
      row.precision >= args.gatePrecision &&
      row.truePositive >= args.minTruePositive &&
      lower >= 0.5;
    if (clearsGate) {
      return {
        ...base,
        status: 'gate-eligible' as PromotionStatus,
        reason:
          `precision ${row.precision.toFixed(3)} (Wilson95 lower ${lower.toFixed(3)}) ` +
          `with ${row.truePositive} TP clears the gate (precision >= ${args.gatePrecision}, ` +
          `TP >= ${args.minTruePositive}) on ${args.scoresFile}`,
      };
    }
    return {
      ...base,
      status: 'advisory-only' as PromotionStatus,
      reason:
        `precision ${row.precision.toFixed(3)} (Wilson95 lower ${lower.toFixed(3)}), ` +
        `${row.truePositive} TP: advisory only, below the gate ` +
        `(precision >= ${args.gatePrecision}, TP >= ${args.minTruePositive}) on ${args.scoresFile}`,
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    computedBy: 'scripts/promotions/compute-promotions.ts',
    scoresFile: args.scoresFile,
    scoresGeneratedAt: scores.generatedAt,
    gatePrecisionThreshold: args.gatePrecision,
    minTruePositiveForGate: args.minTruePositive,
    rows,
    gateEligibleDetectors: rows.filter((r) => r.status === 'gate-eligible').map((r) => r.detector),
    advisoryOnlyDetectors: rows.filter((r) => r.status === 'advisory-only').map((r) => r.detector),
    unmeasuredDetectors: rows.filter((r) => r.status === 'unmeasured').map((r) => r.detector),
    judgePrimary: computeJudgePrimaryPolicy(loadMeasurements(args.measurementsFile)),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const out = computePromotions(args);
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(out, null, 2) + '\n');
  // eslint-disable-next-line no-console
  console.log(
    `compute-promotions: gate-eligible=${out.gateEligibleDetectors.length} ` +
      `advisory-only=${out.advisoryOnlyDetectors.length} ` +
      `unmeasured=${out.unmeasuredDetectors.length} ` +
      `out=${args.out}`,
  );
}

if (require.main === module) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(2);
  });
}
