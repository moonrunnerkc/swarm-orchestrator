// Decide which block triggers may gate, from their revert-calibrated precision.
// A trigger is block-eligible only when its Wilson 95% lower bound clears a
// fixed threshold (0.90, the same precision discipline the detector gate uses)
// with at least a minimum number of confirmed reverted true positives (5). The
// bound, not the point precision, is the gate: a trigger that fired a handful
// of times at precision 1.0 has a low bound and does not qualify.
//
// Honesty is enforced here, not assumed: if nothing clears the bar, the output
// records zero eligible triggers and the reason each fell short. The threshold
// is never lowered to admit a trigger; check-block-policy refuses a committed
// file whose threshold sits below the floor.

import type { BlockTriggerKind } from './block-trigger-types';
import type { TriggerCalibration } from './calibrate-triggers';

/** The fixed bar a trigger must clear to gate. Mirrors the detector gate's
 *  precision discipline; never lowered to admit a trigger. */
export const DEFAULT_WILSON_LOWER_THRESHOLD = 0.9;
export const DEFAULT_MIN_CONFIRMED_REVERTED = 5;

export interface BlockEligibilityRow {
  trigger: BlockTriggerKind;
  firingCount: number;
  truePositive: number;
  falsePositive: number;
  precision: number;
  wilsonLowerBound: number;
  truePositivePrs: string[];
  blockEligible: boolean;
  reason: string;
}

/** The eligibility decision, minus the wall-clock `generatedAt` the writer
 *  stamps on. check-block-policy recomputes this core and compares it byte for
 *  byte, so it must be a pure function of the calibration and thresholds. */
export interface BlockEligibilityCore {
  computedBy: string;
  calibrationFile: string;
  calibrationGeneratedAt: string;
  wilsonLowerThreshold: number;
  minConfirmedRevertedForBlock: number;
  rows: BlockEligibilityRow[];
  blockEligibleTriggers: BlockTriggerKind[];
  blockEligibleCount: number;
}

export interface BlockEligibilityOptions {
  /** Path recorded in the output for provenance. */
  computedBy: string;
  /** The calibration source this decision was computed from. */
  calibrationFile: string;
  /** The calibration's own generatedAt, for provenance. */
  calibrationGeneratedAt: string;
  wilsonLowerThreshold?: number;
  minConfirmedRevertedForBlock?: number;
}

/**
 * Compute block eligibility for every calibrated trigger. A trigger gates only
 * when its Wilson 95% lower bound is at least `wilsonLowerThreshold` (default
 * 0.90) and it has at least `minConfirmedRevertedForBlock` (default 5) confirmed
 * reverted true positives. Pure: the same calibration and thresholds always
 * produce the same core, which is what the CI check recomputes against.
 *
 * @param calibrations per-trigger revert calibration
 * @param opts provenance and the (fixed) thresholds
 * @returns the eligibility core, with one row per trigger and the eligible set
 */
export function computeBlockEligibility(
  calibrations: readonly TriggerCalibration[],
  opts: BlockEligibilityOptions,
): BlockEligibilityCore {
  const wilsonLowerThreshold = opts.wilsonLowerThreshold ?? DEFAULT_WILSON_LOWER_THRESHOLD;
  const minConfirmedRevertedForBlock =
    opts.minConfirmedRevertedForBlock ?? DEFAULT_MIN_CONFIRMED_REVERTED;
  const rows: BlockEligibilityRow[] = calibrations.map((c) => {
    const blockEligible =
      c.wilsonLowerBound >= wilsonLowerThreshold && c.truePositive >= minConfirmedRevertedForBlock;
    const reason = blockEligible
      ? `block-eligible: Wilson95 lower ${c.wilsonLowerBound.toFixed(3)} >= ${wilsonLowerThreshold} ` +
        `with ${c.truePositive} confirmed reverted true positive(s) (>= ${minConfirmedRevertedForBlock}). ` +
        `Proof PRs: ${c.truePositivePrs.join(', ')}.`
      : `not block-eligible: Wilson95 lower ${c.wilsonLowerBound.toFixed(3)} (need >= ${wilsonLowerThreshold}), ` +
        `${c.truePositive} confirmed reverted TP (need >= ${minConfirmedRevertedForBlock}) over ` +
        `${c.firingCount} firing(s) on ${opts.calibrationFile}.`;
    return {
      trigger: c.trigger,
      firingCount: c.firingCount,
      truePositive: c.truePositive,
      falsePositive: c.falsePositive,
      precision: c.precision,
      wilsonLowerBound: c.wilsonLowerBound,
      truePositivePrs: c.truePositivePrs,
      blockEligible,
      reason,
    };
  });
  const blockEligibleTriggers = rows.filter((r) => r.blockEligible).map((r) => r.trigger);
  return {
    computedBy: opts.computedBy,
    calibrationFile: opts.calibrationFile,
    calibrationGeneratedAt: opts.calibrationGeneratedAt,
    wilsonLowerThreshold,
    minConfirmedRevertedForBlock,
    rows,
    blockEligibleTriggers,
    blockEligibleCount: blockEligibleTriggers.length,
  };
}
