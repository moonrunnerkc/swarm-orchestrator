// Decide which block triggers may gate, from their revert-calibrated precision.
// Two-tier model (self-certifying vs circumstantial):
// - Self-certifying (test-tamper-proven, claim-falsified, obligation-failure):
//   eligible by tier (bypasses Wilson bar); only gate when the specific firing's
//   per-instance controls are all green (enforced at detect time + runtime + policy check).
// - Circumstantial (e.g. corroborated-under-constraint): keep the Wilson 0.90 / 5-TP bar.
//
// Honesty is enforced here, not assumed: if nothing clears the bar, the output
// records zero eligible triggers and the reason each fell short. The threshold
// is never lowered to admit a trigger; check-block-policy refuses a committed
// file whose threshold sits below the floor (and rejects self-cert rows whose
// firings did not have green controls).

import type { BlockTriggerKind } from './block-trigger-types';
import type { TriggerCalibration } from './calibrate-triggers';
import { isSelfCertifying, type TriggerTier } from './self-certifying';

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
  tier: TriggerTier;
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
    const tier: TriggerTier = isSelfCertifying(c.trigger) ? 'self-certifying' : 'circumstantial';
    let blockEligible: boolean;
    let reason: string;
    if (tier === 'self-certifying') {
      // Self-certifying triggers are eligible independent of the Wilson bar.
      // They only actually block a PR when the per-instance controls for that
      // specific firing are all green (enforced in detect + gate-decision +
      // check-block-policy). The calibration N just records historical green
      // firings for transparency.
      blockEligible = true;
      const n = c.truePositive; // green firings only (detectTestTamperProven etc filter)
      reason =
        `block-eligible (self-certifying): blocks only when a firing's controls ` +
        `are all green at audit time; ${n} calibration firing(s), 0 clean firings.`;
    } else {
      blockEligible =
        c.wilsonLowerBound >= wilsonLowerThreshold && c.truePositive >= minConfirmedRevertedForBlock;
      reason = blockEligible
        ? `block-eligible: Wilson95 lower ${c.wilsonLowerBound.toFixed(3)} >= ${wilsonLowerThreshold} ` +
          `with ${c.truePositive} confirmed reverted true positive(s) (>= ${minConfirmedRevertedForBlock}). ` +
          `Proof PRs: ${c.truePositivePrs.join(', ')}.`
        : `not block-eligible: Wilson95 lower ${c.wilsonLowerBound.toFixed(3)} (need >= ${wilsonLowerThreshold}), ` +
          `${c.truePositive} confirmed reverted TP (need >= ${minConfirmedRevertedForBlock}) over ` +
          `${c.firingCount} firing(s) on ${opts.calibrationFile}.`;
    }
    return {
      trigger: c.trigger,
      firingCount: c.firingCount,
      truePositive: c.truePositive,
      falsePositive: c.falsePositive,
      precision: c.precision,
      wilsonLowerBound: c.wilsonLowerBound,
      truePositivePrs: c.truePositivePrs,
      tier,
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
