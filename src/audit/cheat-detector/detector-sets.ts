// Detector sets and selection. The split between `default` and
// `experimental` exists so the audit surface only loads detectors
// that have earned their context against real PR data.
//
// Selection is driven by the `--detectors <set>` CLI flag:
//   - `default` (the implicit default) loads the advisory-grade
//     detectors that are worth running on every audit.
//   - `experimental` loads default + retired detectors, for use
//     in shadow mode or against the synthetic regression corpus.
//   - `all` is an alias for `experimental` and matches the v10.1
//     behavior for callers that pinned the old name.
//
// Selection is *not* a permission check on the per-detector severity
// table; it is a registry-load filter. A detector that does not load
// also does not appear in the rendered PR comment, the AIBOM, or the
// ledger detector-versions map.
//
// The default set was rebalanced after the wild-PR scan (see
// docs/posts/2026-05-27-wild-pr-scan.md). Three detectors that had
// been pushed to `experimental` against the synthetic corpus produced
// the only sharp catches on real merged PRs:
//   - coverage-erosion caught a self-described bug fix shipped with
//     no test (cline/cline#11092), with severity correctly escalated
//     from the PR body's "This PR fixes them." claim.
//   - assertion-strip + test-relaxation caught test deletions in a
//     refactor PR (RooCodeInc/Roo-Code#12347).
// These three moved back into `default`. The remaining three retired
// detectors (comment-only-fix, exception-rethrow-lost-context,
// dead-branch-insertion) stay in experimental because they fired
// zero times on both runs.

import type { Detector } from './detector-types';
import { testRelaxationDetector } from './test-relaxation';
import { mockOfHallucinationDetector } from './mock-of-hallucination';
import { assertionStripDetector } from './assertion-strip';
import { noOpFixDetector } from './no-op-fix';
import { coverageErosionDetector } from './coverage-erosion';
import { fakeRefactorDetector } from './fake-refactor';
import { commentOnlyFixDetector } from './comment-only-fix';
import { errorSwallowDetector } from './error-swallow';
import { exceptionRethrowLostContextDetector } from './exception-rethrow-lost-context';
import { deadBranchInsertionDetector } from './dead-branch-insertion';
import { typeSuppressionDetector } from './type-suppression';

export type DetectorSet = 'default' | 'experimental' | 'all';

// Default set: the seven detectors that earned their context against
// real PR data. coverage-erosion / assertion-strip / test-relaxation
// were promoted back in after the wild-PR scan demonstrated they were
// the only detectors making sharp catches on real merged PRs (the
// four previously-default detectors produced 481 findings, 0
// confirmed cheats after triage).
export const DEFAULT_DETECTORS: readonly Detector[] = [
  errorSwallowDetector,
  mockOfHallucinationDetector,
  noOpFixDetector,
  fakeRefactorDetector,
  coverageErosionDetector,
  testRelaxationDetector,
  assertionStripDetector,
  // Added in v11 after the regression-corpus mining: silencing the type
  // checker or linter over a flagged line is a cheat no security analyzer
  // keys on. Mirrored by an injector so its recall is scored on the oracle.
  typeSuppressionDetector,
];

// Still in experimental: three detectors that fired zero times on
// the wild-PR scan in both runs. No signal to gauge precision or
// recall against. Available via `--detectors experimental` for
// shadow-mode operators and the synthetic regression corpus.
export const EXPERIMENTAL_DETECTORS: readonly Detector[] = [
  commentOnlyFixDetector,
  exceptionRethrowLostContextDetector,
  deadBranchInsertionDetector,
];

export function resolveDetectors(set: DetectorSet): readonly Detector[] {
  if (set === 'default') return DEFAULT_DETECTORS;
  return [...DEFAULT_DETECTORS, ...EXPERIMENTAL_DETECTORS];
}

export function parseDetectorSet(raw: string | undefined): DetectorSet {
  if (raw === undefined) return 'default';
  if (raw === 'default' || raw === 'experimental' || raw === 'all') return raw;
  throw new Error(
    `invalid --detectors value "${raw}"; expected default | experimental | all`,
  );
}
