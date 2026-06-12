import type { BlockTrigger, BlockTriggerKind } from './block-trigger-types';
import type { RestorationControls } from '../execution-grounded/test-restoration';
import type { MockRestorationControls } from '../execution-grounded/mock-restoration';
import type { NoOpFixControls } from '../execution-grounded/no-op-fix-restoration';
import type { TypeSuppressionControls } from '../execution-grounded/type-suppression-restoration';
import type { FakeRefactorControls } from '../execution-grounded/fake-refactor-restoration';
import type { DeadBranchControls } from '../execution-grounded/dead-branch-restoration';

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
  'mock-mutation-proven',
  'no-op-fix-proven',
  'type-suppression-proven',
  'fake-refactor-proven',
  'dead-branch-proven',
];

export function isSelfCertifying(kind: BlockTriggerKind): boolean {
  return (SELF_CERTIFYING_TRIGGERS as readonly string[]).includes(kind);
}

/** Returns true only for firings whose per-instance controls are all green.
 * For test-tamper-proven this is the three restoration controls. For
 * claim-falsified the repro must have failed twice on both the base and the
 * patched side (the re-run controls). For obligation-failure the obligation
 * must have failed on both runs. A single-run or split-run firing is advisory
 * only: the trigger may still surface in the comment, but it never gates.
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
  if (e.kind === 'claim-falsified') {
    return (
      e.preRuns.length === 2 &&
      e.postRuns.length === 2 &&
      e.preRuns.every((s) => s === 'failed') &&
      e.postRuns.every((s) => s === 'failed')
    );
  }
  if (e.kind === 'obligation-failure') {
    return e.runsPassed.length === 2 && e.runsPassed.every((passed) => passed === false);
  }
  if (e.kind === 'mock-mutation-proven') {
    const c: MockRestorationControls = e.controls;
    return (
      c.tamperedSuitePasses === true &&
      c.restoredFailsTwiceSameIdentity === true &&
      c.mockReturnsAssertedValue === true
    );
  }
  if (e.kind === 'no-op-fix-proven') {
    const c: NoOpFixControls = e.controls;
    return (
      c.prClaimsFix === true &&
      c.suitePassesAsSubmitted === true &&
      c.revertedSuiteStillPassesTwice === true
    );
  }
  if (e.kind === 'type-suppression-proven') {
    const c: TypeSuppressionControls = e.controls;
    return (
      c.directiveRemoved === true &&
      c.fileCleanAsSubmitted === true &&
      c.diagnosticSurfacesWhenRemoved === true
    );
  }
  if (e.kind === 'fake-refactor-proven') {
    const c: FakeRefactorControls = e.controls;
    return (
      c.oldSymbolResolved === true &&
      c.oldSymbolDeclarationRemoved === true &&
      c.oldSymbolStillReferenced === true
    );
  }
  if (e.kind === 'dead-branch-proven') {
    const c: DeadBranchControls = e.controls;
    return (
      c.branchResolved === true &&
      c.suitePassesAsSubmitted === true &&
      c.branchNeverExecuted === true
    );
  }
  return false;
}
