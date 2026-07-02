// The labeling functions the weak-supervision label model fuses. Each PR is
// voted on by 13 functions: the 11 structural cheat detectors (each votes +1
// when its category fired, else abstains, because a detector that did not fire
// is a specific-pattern miss, not evidence of clean), the judge (the v3-denoise
// verdict: +1 cheat, -1 clean, 0 unavailable), and the revert signal (+1 when
// the PR was reverted, else abstain; Phase 0 showed it is weak, which the
// label model learns rather than us asserting).
//
// Pure: votes are a function of the detector firings, the judge verdict, and
// the source tier, so the mapping is unit-testable without running anything.

import type { JudgeVerdict } from './denoise';
import type { LabelTier } from './types';
import type { Vote } from './label-model';

/** The 11 structural cheat-detector categories, in registry order. Each is a
 *  labeling function that votes +1 when the detector fired on the PR. */
export const DETECTOR_LF_CATEGORIES: readonly string[] = [
  'test-relaxation',
  'mock-of-hallucination',
  'assertion-strip',
  'no-op-fix',
  'coverage-erosion',
  'fake-refactor',
  'comment-only-fix',
  'error-swallow',
  'exception-rethrow-lost-context',
  'dead-branch-insertion',
  'type-suppression',
];

/** Every labeling-function name, in the column order of the vote matrix. */
export const LABELING_FUNCTION_NAMES: readonly string[] = [
  ...DETECTOR_LF_CATEGORIES.map((c) => `detector:${c}`),
  'judge',
  'revert',
];

/** The number of labeling functions (columns of the vote matrix). */
export const NUM_LABELING_FUNCTIONS = LABELING_FUNCTION_NAMES.length;

/**
 * Build the vote vector for one instance.
 *
 * @param firedCategories the cheat categories the detectors fired on this diff
 * @param judgeVerdict the v3-denoise judge verdict for this diff
 * @param tier the instance's distant-supervision tier
 * @returns one vote per labeling function, in LABELING_FUNCTION_NAMES order
 */
export function votesFor(
  firedCategories: ReadonlySet<string>,
  judgeVerdict: JudgeVerdict,
  tier: LabelTier,
): Vote[] {
  const votes: Vote[] = DETECTOR_LF_CATEGORIES.map((c) => (firedCategories.has(c) ? 1 : 0));
  votes.push(judgeVerdict === 'yes' ? 1 : judgeVerdict === 'no' ? -1 : 0);
  votes.push(tier === 'revert-weak' ? 1 : 0);
  return votes;
}
