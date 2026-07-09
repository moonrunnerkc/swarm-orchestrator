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
import { wilsonLowerBound } from './wilson';

/** The fixed bar a trigger must clear to gate. Mirrors the detector gate's
 *  precision discipline; never lowered to admit a trigger. */
export const DEFAULT_WILSON_LOWER_THRESHOLD = 0.9;
export const DEFAULT_MIN_CONFIRMED_REVERTED = 5;

/** One diagnosed, still-live false positive from the FP registry: the gate fired
 *  its trigger on a PR later confirmed clean, and no refuter yet neutralizes it.
 *  A registry entry that a refuter DOES neutralize contributes none of these (it
 *  no longer fires), so a fixed FP class does not keep demoting its trigger. */
export interface RegistryFalsePositive {
  trigger: BlockTriggerKind;
  /** The PR the false positive fired on, for the row's provenance. */
  pr: string;
}

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
  registryFalsePositives: readonly RegistryFalsePositive[] = [],
): BlockEligibilityCore {
  const wilsonLowerThreshold = opts.wilsonLowerThreshold ?? DEFAULT_WILSON_LOWER_THRESHOLD;
  const minConfirmedRevertedForBlock =
    opts.minConfirmedRevertedForBlock ?? DEFAULT_MIN_CONFIRMED_REVERTED;
  const rows: BlockEligibilityRow[] = calibrations.map((c) => {
    const tier: TriggerTier = isSelfCertifying(c.trigger) ? 'self-certifying' : 'circumstantial';
    // Fold any still-live FP-registry firings for this trigger into its
    // denominators. A registry entry a refuter neutralizes contributes nothing
    // (it no longer fires), so a fixed FP class stops demoting.
    const registryFps = registryFalsePositives.filter((r) => r.trigger === c.trigger).length;
    const truePositive = c.truePositive;
    const falsePositive = c.falsePositive + registryFps;
    const firingCount = c.firingCount + registryFps;
    const precision = firingCount === 0 ? 0 : truePositive / firingCount;
    const wilson = registryFps === 0 ? c.wilsonLowerBound : wilsonLowerBound(truePositive, firingCount);
    let blockEligible: boolean;
    let reason: string;
    if (tier === 'self-certifying') {
      // Self-certifying triggers are eligible by tier and block only when the
      // per-instance controls for that firing are all green (enforced in detect
      // + gate-decision + check-block-policy). They stay eligible independent of
      // the Wilson bar UNLESS confirmed false positives accrue and drop the
      // Wilson-95 lower bound below it: a trigger demonstrably firing on clean
      // PRs auto-demotes to advisory by the same bar the circumstantial tier
      // uses, until the FP class is neutralized (a refuter drops the firings) and
      // precision recovers. A trigger with zero false positives is never demoted,
      // whatever its true-positive count.
      if (falsePositive >= 1 && wilson < wilsonLowerThreshold) {
        blockEligible = false;
        reason =
          `auto-demoted to advisory (self-certifying): ${falsePositive} confirmed false positive(s) ` +
          `drop Wilson95 lower to ${wilson.toFixed(3)} (< ${wilsonLowerThreshold}) over ${firingCount} ` +
          `firing(s); the trigger stays advisory until the FP class is neutralized and precision recovers.`;
      } else {
        blockEligible = true;
        reason =
          `block-eligible (self-certifying): blocks only when a firing's controls ` +
          `are all green at audit time; ${truePositive} calibration firing(s), ${falsePositive} clean firings.`;
      }
    } else {
      blockEligible =
        wilson >= wilsonLowerThreshold && truePositive >= minConfirmedRevertedForBlock;
      reason = blockEligible
        ? `block-eligible: Wilson95 lower ${wilson.toFixed(3)} >= ${wilsonLowerThreshold} ` +
          `with ${truePositive} confirmed reverted true positive(s) (>= ${minConfirmedRevertedForBlock}). ` +
          `Proof PRs: ${c.truePositivePrs.join(', ')}.`
        : `not block-eligible: Wilson95 lower ${wilson.toFixed(3)} (need >= ${wilsonLowerThreshold}), ` +
          `${truePositive} confirmed reverted TP (need >= ${minConfirmedRevertedForBlock}) over ` +
          `${firingCount} firing(s) on ${opts.calibrationFile}.`;
    }
    return {
      trigger: c.trigger,
      firingCount,
      truePositive,
      falsePositive,
      precision,
      wilsonLowerBound: wilson,
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
