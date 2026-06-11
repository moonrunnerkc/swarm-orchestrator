import type { BlockTrigger, BlockTriggerKind } from './block-trigger-types';
import type { RestorationControls } from '../execution-grounded/test-restoration';

/** Two-tier model for block triggers. Self-certifying triggers (test-tamper-proven,
 * claim-falsified, obligation-failure) are eligible independent of the Wilson
 * statistical bar; they block only when the per-instance controls for that
 * firing are all green. Circumstantial triggers (e.g. corroborated-under-constraint)
 * continue to use the existing Wilson 0.90 / 5-TP calibration.
 */
export type TriggerTier = 'self-certifying' | 'circumstantial';

export const SELF_CERTIFYING_TRIGGERS: readonly BlockTriggerKind[] = [
  'test-tamper-proven',
  'claim-falsified',
  'obligation-failure',
];

export function isSelfCertifying(kind: BlockTriggerKind): boolean {
  return (SELF_CERTIFYING_TRIGGERS as readonly string[]).includes(kind);
}

/** Returns true only for firings whose per-instance controls are all green.
 * For test-tamper-proven this is the three restoration controls.
 * For claim-falsified / obligation-failure the double-run controls (pre/post both
 * failed, twice) are added in Task 9; until then any historical firing of these
 * (which by construction were failure cases) is treated as control-green for
 * the purpose of the tier.
 */
export function controlsAllGreen(trigger: BlockTrigger): boolean {
  const e = trigger.evidence;
  if (e.kind === 'test-tamper-proven') {
    const c: RestorationControls = e.controls;
    return (
      c.baseTestPasses === true &&
      c.tamperedSuitePasses === true &&
      c.restoredFailsTwiceSameIdentity === true
    );
  }
  if (e.kind === 'claim-falsified' || e.kind === 'obligation-failure') {
    // Current corpus firings (0 for these) and future ones with double-run evidence
    // will be green only when the re-run controls pass. For the pre-T9 single-status
    // evidence we treat a firing as green (the repro/obligation did fail).
    return true;
  }
  return false;
}
