// Detector sets and selection. v10.2 introduces the default vs.
// experimental split so the audit surface only loads detectors that
// have earned their context on the real-corpus baseline.
//
// "Default" detectors are the four advisory-grade detectors targeted
// for v2.0 in the same release. The other six are retired to
// `experimental` because either (a) their real-corpus measurement is
// 0 TPs / 0 FPs (no signal to gauge) or (b) the FP class on real
// agent PRs is unfixable within the current detector shape.
//
// Selection is driven by the `--detectors <set>` CLI flag:
//   - `default` (the implicit default) loads the four advisory
//     detectors.
//   - `experimental` loads default + all retired detectors, so
//     operators can still exercise them in shadow mode or against
//     the synthetic regression corpus.
//   - `all` is an alias for `experimental` and matches the v10.1
//     behavior for callers that pinned the old name.
//
// Selection is *not* a permission check on the per-detector severity
// table; it is a registry-load filter. A detector that does not load
// also does not appear in the rendered PR comment, the AIBOM, or the
// ledger detector-versions map.

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

export type DetectorSet = 'default' | 'experimental' | 'all';

// The four advisory-grade detectors. Each is targeted for a v2.0
// precision / recall measurement on the human-labeled corpus.
export const DEFAULT_DETECTORS: readonly Detector[] = [
  errorSwallowDetector,
  mockOfHallucinationDetector,
  noOpFixDetector,
  fakeRefactorDetector,
];

// Retired in v10.2-advisory. Available behind `--detectors experimental`.
// The six entries split into two groups by retirement reason:
//   1. Zero TP / zero FP on the v10.1 real corpus (comment-only-fix,
//      exception-rethrow-lost-context, dead-branch-insertion) — no
//      signal to gauge precision, recall, or false-positive cost.
//   2. FP-only on the v10.1 real corpus with no clear AST-level
//      replacement (assertion-strip, coverage-erosion, test-relaxation)
//      — measurable cost, no measurable value at the current shape.
export const EXPERIMENTAL_DETECTORS: readonly Detector[] = [
  commentOnlyFixDetector,
  exceptionRethrowLostContextDetector,
  deadBranchInsertionDetector,
  assertionStripDetector,
  coverageErosionDetector,
  testRelaxationDetector,
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
