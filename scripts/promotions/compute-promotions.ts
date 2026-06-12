// Compute the per-detector promotion record at
// `benchmarks/real-corpus/promotions.json` so the gate-eligible list is
// auditable.
//
// Reads the most recent real-corpus scores snapshot
// (`benchmarks/real-corpus/scores/latest.json` by default) and emits
// one row per detector with:
//
//   - the measured precision, recall, F1, firing count
//   - the proposed status: `gate-eligible` (precision >= threshold with a
//     minimum TP count and Wilson lower bound), `advisory-only` (fired but
//     below the gate), or `unmeasured` (did not fire on the sample)
//   - the corroborated tier: the same gate computed on the detector's
//     runtime-corroborated subset, so a detector that is noisy standalone can
//     still gate on the findings an execution signal confirmed
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
    /** TP/FP counted only among this detector's runtime-corroborated findings
     *  (the corroborate.ts step backed them with a surviving mutant, coverage
     *  gap, or still-failing repro). Absent until the scorer runs the
     *  execution-grounded layer on the labeled corpus; absent leaves the
     *  detector corroborated-unmeasured. */
    corroborated?: { truePositive: number; falsePositive: number };
  }>;
}

export type PromotionStatus = 'gate-eligible' | 'advisory-only' | 'unmeasured';

// The corroborated tier has one extra state the standalone tier does not: a
// static EG-viability screen can run (cheaply) even when the execution-grounded
// corroboration run has not, so the tier reports `viability-screened` (the
// viable slice is measured, corroborated precision pending the bounded EG run)
// instead of the opaque `unmeasured`.
export type CorroboratedStatus = PromotionStatus | 'viability-screened';

/** Summary of the static EG-viability screen, folded into the corroborated
 *  tier so promotions.json reports the measured viable slice. */
interface ViabilitySummary {
  screened: number;
  viableCount: number;
  egNodeMajor: number;
  nonViableReasonCounts: Record<string, number>;
  evidenceFile: string;
  /** Present once the bounded EG run on the viable slice has completed
   *  (the dispatch's aggregated corroborated summary, sibling of the screen).
   *  Lets the corroborated reason read "measured" instead of "pending". */
  measured?: { prsMeasured: number; prsCovered: number; corroboratedSummaryFile: string };
}

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

/** The corroborated-mode eligibility for a detector: its precision on the
 *  runtime-corroborated subset of its findings. A detector can clear the
 *  corroborated gate even when its standalone precision is below it, because a
 *  finding that also leaves a surviving mutant (or fails the repro) is far more
 *  likely a real cheat. `unmeasured` means no corroborated subset was scored. */
export interface CorroboratedTier {
  truePositive: number;
  falsePositive: number;
  firingCount: number;
  precision: number;
  status: CorroboratedStatus;
  reason: string;
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
  corroborated: CorroboratedTier;
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
  /** Detectors that clear the gate on their runtime-corroborated subset even
   *  if they do not clear it standalone. The path to the first gate. */
  corroboratedGateEligibleDetectors: string[];
  judgePrimary: JudgePrimaryPolicy;
  /** The static EG-viability screen result, present once the screen has run.
   *  Replaces the bare corroborated-"unmeasured" with the measured viable
   *  slice; the corroborated precision run on that slice is the next step. */
  executionGroundedViability?: ViabilitySummary;
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

/**
 * The corroborated-mode tier for one detector: precision on the subset of its
 * findings that runtime corroboration backed. Same gate shape as standalone
 * (precision, minimum TP, Wilson lower bound), but on the corroborated subset,
 * so a detector that is noisy standalone can still gate on the findings a
 * surviving mutant or failed repro confirms. `unmeasured` when no subset was
 * scored. Pure.
 */
export function corroboratedTier(
  corroborated: { truePositive: number; falsePositive: number } | undefined,
  gatePrecision: number,
  minTruePositive: number,
  scoresFile: string,
  viability?: ViabilitySummary,
): CorroboratedTier {
  // When a corroborated subset has not been scored, the honest state is no
  // longer a bare "unmeasured": the static viability screen tells us exactly
  // how much of the corpus could even provision for an EG run. Report that.
  const unmeasured = (reasonWithoutScreen: string): CorroboratedTier => {
    if (viability !== undefined) {
      const screen =
        `EG-viability screen: ${viability.viableCount}/${viability.screened} PRs provision ` +
        `(Node + lockfile + test runner + node@${viability.egNodeMajor} engine; see ` +
        `${viability.evidenceFile}).`;
      const m = viability.measured;
      const reason =
        m !== undefined
          ? `${screen} Bounded EG run completed: ${m.prsMeasured}/${m.prsCovered} of the viable ` +
            `slice provisioned and ran the execution-grounded layer ` +
            `(${m.prsCovered - m.prsMeasured} non-viable, reported in ${m.corroboratedSummaryFile}); ` +
            `0 corroborated findings on the outcome-clean slice, so the corroborated tier stays ` +
            `advisory (no outcome-bad PR in the slice can yield a true positive). Nothing gates on ` +
            `the corroborated tier; the mining cron grows the slice toward an outcome-bad positive class.`
          : `${screen} Corroborated precision is pending the bounded EG run on that ` +
            `${viability.viableCount}-PR slice; nothing gates on the corroborated tier until then.`;
      return {
        truePositive: 0,
        falsePositive: 0,
        firingCount: 0,
        precision: 0,
        status: 'viability-screened',
        reason,
      };
    }
    return {
      truePositive: 0,
      falsePositive: 0,
      firingCount: 0,
      precision: 0,
      status: 'unmeasured',
      reason: reasonWithoutScreen,
    };
  };
  if (corroborated === undefined) {
    return unmeasured(
      'no runtime-corroborated subset scored (run the execution-grounded layer on the labeled corpus)',
    );
  }
  const firingCount = corroborated.truePositive + corroborated.falsePositive;
  if (firingCount === 0) {
    return unmeasured('detector produced no runtime-corroborated findings on the sample');
  }
  const precision = corroborated.truePositive / firingCount;
  const lower = wilsonLowerBound(corroborated.truePositive, firingCount);
  const clears = precision >= gatePrecision && corroborated.truePositive >= minTruePositive && lower >= 0.5;
  return {
    truePositive: corroborated.truePositive,
    falsePositive: corroborated.falsePositive,
    firingCount,
    precision,
    status: clears ? 'gate-eligible' : 'advisory-only',
    reason: clears
      ? `corroborated precision ${precision.toFixed(3)} (Wilson95 lower ${lower.toFixed(3)}) with ` +
        `${corroborated.truePositive} TP on the runtime-corroborated subset clears the corroborated ` +
        `gate (precision >= ${gatePrecision}, TP >= ${minTruePositive}) on ${scoresFile}`
      : `corroborated precision ${precision.toFixed(3)} (Wilson95 lower ${lower.toFixed(3)}), ` +
        `${corroborated.truePositive} TP: below the corroborated gate ` +
        `(precision >= ${gatePrecision}, TP >= ${minTruePositive}) on ${scoresFile}`,
  };
}

/** Read the EG-viability screen that sits beside the scores snapshot
 *  (`<corpus>/eg-viability.json`, sibling of `<corpus>/scores/`). Derived from
 *  the scoresFile so a recompute and the committed policy agree, and so the
 *  unit test's temp scoresFile (no sibling screen) is unaffected. */
function loadViability(scoresFile: string): ViabilitySummary | undefined {
  const file = path.join(path.dirname(scoresFile), '..', 'eg-viability.json');
  if (!fs.existsSync(file)) return undefined;
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      screened: number;
      viableCount: number;
      egNodeMajor: number;
      nonViableReasonCounts: Record<string, number>;
    };
    const summary: ViabilitySummary = {
      screened: v.screened,
      viableCount: v.viableCount,
      egNodeMajor: v.egNodeMajor,
      nonViableReasonCounts: v.nonViableReasonCounts,
      evidenceFile: path.relative(process.cwd(), file),
    };
    const measuredFile = path.join(path.dirname(file), 'eg-viable-corroborated.json');
    if (fs.existsSync(measuredFile)) {
      try {
        const m = JSON.parse(fs.readFileSync(measuredFile, 'utf8')) as {
          prsMeasured: number;
          prsCovered: number;
        };
        if (typeof m.prsMeasured === 'number' && typeof m.prsCovered === 'number') {
          summary.measured = {
            prsMeasured: m.prsMeasured,
            prsCovered: m.prsCovered,
            corroboratedSummaryFile: path.relative(process.cwd(), measuredFile),
          };
        }
      } catch {
        // A malformed summary leaves the tier reading "pending"; never throws.
      }
    }
    return summary;
  } catch {
    return undefined;
  }
}

export function computePromotions(args: Args): PromotionsOutput {
  const text = fs.readFileSync(args.scoresFile, 'utf8');
  const scores = JSON.parse(text) as ScoresSnapshot;
  const viability = loadViability(args.scoresFile);
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
      corroborated: corroboratedTier(
        row.corroborated,
        args.gatePrecision,
        args.minTruePositive,
        args.scoresFile,
        viability,
      ),
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
    corroboratedGateEligibleDetectors: rows
      .filter((r) => r.corroborated.status === 'gate-eligible')
      .map((r) => r.detector),
    judgePrimary: computeJudgePrimaryPolicy(loadMeasurements(args.measurementsFile)),
    ...(viability !== undefined ? { executionGroundedViability: viability } : {}),
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
