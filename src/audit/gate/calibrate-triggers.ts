// Calibrate each block trigger against revert/hotfix ground truth. Over a
// retrospective corpus of merged PRs whose outcome is known (it was reverted or
// hotfixed, or it was not), a trigger's precision is the fraction of the PRs it
// fired on that actually went wrong in production. This is the trustworthiness
// of blocking on the trigger, measured against what production did, not against
// any label. The Wilson 95% lower bound and the confirmed true-positive count
// keep a trigger that fired a handful of times from looking trustworthy on luck.

import {
  ALL_BLOCK_TRIGGER_KINDS,
  type BlockTriggerKind,
} from './block-trigger-types';
import { wilsonLowerBound } from './wilson';

/** One corpus PR's outcome: which triggers fired on it and whether it was
 *  later reverted or hotfixed (the label-free ground truth). */
export interface TriggerFiringRecord {
  /** PR identifier, e.g. `owner/repo#123`. */
  pr: string;
  /** Trigger kinds that fired on this PR (deduplicated by the caller). */
  fired: BlockTriggerKind[];
  /** Whether this PR was later reverted or hotfixed. */
  revertedOrHotfixed: boolean;
}

/** The measured trustworthiness of one trigger against revert history. */
export interface TriggerCalibration {
  trigger: BlockTriggerKind;
  /** PRs the trigger fired on. */
  firingCount: number;
  /** Of those, how many were reverted or hotfixed (confirmed true positives). */
  truePositive: number;
  /** Of those, how many were not reverted or hotfixed. */
  falsePositive: number;
  /** truePositive / firingCount, or 0 when the trigger never fired. */
  precision: number;
  /** Wilson 95% lower bound on the precision. */
  wilsonLowerBound: number;
  /** The reverted/hotfixed PRs the trigger fired on, for the report. */
  truePositivePrs: string[];
}

/**
 * Score every block trigger against a corpus of PRs with known revert/hotfix
 * outcomes. For each trigger, precision is (reverted-or-hotfixed PRs it fired
 * on) / (all PRs it fired on); a trigger that never fired has precision 0 and a
 * Wilson lower bound of 0. Pure: the same records always produce the same
 * calibration.
 *
 * @param records one entry per corpus PR with its fired triggers and outcome
 * @returns one calibration per trigger kind, in the canonical kind order
 */
export function calibrateTriggers(records: readonly TriggerFiringRecord[]): TriggerCalibration[] {
  return ALL_BLOCK_TRIGGER_KINDS.map((trigger) => {
    const fired = records.filter((r) => r.fired.includes(trigger));
    const truePositivePrs = fired.filter((r) => r.revertedOrHotfixed).map((r) => r.pr);
    const truePositive = truePositivePrs.length;
    const firingCount = fired.length;
    const falsePositive = firingCount - truePositive;
    const precision = firingCount === 0 ? 0 : truePositive / firingCount;
    return {
      trigger,
      firingCount,
      truePositive,
      falsePositive,
      precision,
      wilsonLowerBound: wilsonLowerBound(truePositive, firingCount),
      truePositivePrs,
    };
  });
}
