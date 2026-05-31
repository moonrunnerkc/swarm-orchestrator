// Per-detector measured-precision table. The numbers come from
// `benchmarks/real-corpus/scores/latest.json` at the time of the
// release that pinned them. Embedding the table in source keeps the
// PR comment renderer self-contained (no runtime read of a benchmark
// JSON), and makes the measurement auditable from `git log`.
//
// When a detector's v2.0 precision/recall lands on the held-out
// human-labeled corpus, bump the entry below and the detector's
// version string in the same commit. The `lastMeasuredAt` field is
// the date of the corpus snapshot, not the date of this commit.
//
// Detectors not in the table render as `(unmeasured)`. New detectors
// MUST measure before they are added to the default set.

import type { CheatCategory } from '../types';

export interface DetectorPrecision {
  /** Detector name (matches the `name` field on the Detector object). */
  name: CheatCategory;
  /** Pinned detector version this precision was measured against. */
  measuredVersion: string;
  /**
   * Precision = TP / (TP + FP) on the most recent published corpus.
   * `null` means the detector did not fire on the sample (no TP and
   * no FP), so no precision is defined.
   */
  precision: number | null;
  /** Recall = TP / (TP + FN). `null` when no positives in the sample. */
  recall: number | null;
  /** TP + FP. Smaller numbers mean larger uncertainty bars. */
  firingCount: number;
  /** Source corpus identifier so the reader can audit the number. */
  corpus: string;
  /** ISO date the corpus snapshot was scored. */
  lastMeasuredAt: string;
}

/**
 * Measurements pinned at v10.1 from the 205-PR hand-labeled real-corpus
 * baseline (`benchmarks/real-corpus/scores/latest.json`). The four
 * detectors retained in the default set are listed first; the six
 * retired detectors follow so the table still answers the question
 * "what was the measured precision when we retired this?".
 */
const CORPUS = 'real-corpus (205 PRs, AI-labeled, pending human re-label)';
const MEASURED_AT = '2026-05-31';

// Deterministic (judge-off) scored path from
// `benchmarks/real-corpus/scores/latest.json`, re-measured after the
// v10.4 verification stage (internal-roots-from-diff and action-version
// demotion on mock-of-hallucination, plus the refuters). error-swallow
// is the only detector with a true positive on this corpus; the rest
// are advisory candidate generators whose blocks are gated by the judge
// confirmation stage. The CI policy guard keeps this aligned with the
// scores snapshot.
const TABLE: readonly DetectorPrecision[] = [
  {
    name: 'error-swallow',
    measuredVersion: '2.0.0',
    precision: 0.188,
    recall: 1.0,
    firingCount: 16,
    corpus: CORPUS,
    lastMeasuredAt: MEASURED_AT,
  },
  {
    name: 'mock-of-hallucination',
    measuredVersion: '2.0.0',
    precision: 0.0,
    recall: 0.0,
    firingCount: 3,
    corpus: CORPUS,
    lastMeasuredAt: MEASURED_AT,
  },
  {
    name: 'no-op-fix',
    measuredVersion: '2.0.0',
    precision: 0.0,
    recall: 0.0,
    firingCount: 9,
    corpus: CORPUS,
    lastMeasuredAt: MEASURED_AT,
  },
  {
    name: 'fake-refactor',
    measuredVersion: '2.0.0',
    precision: 0.0,
    recall: null,
    firingCount: 2,
    corpus: CORPUS,
    lastMeasuredAt: MEASURED_AT,
  },
  {
    name: 'assertion-strip',
    measuredVersion: '1.0.0',
    precision: 0.0,
    recall: null,
    firingCount: 5,
    corpus: CORPUS,
    lastMeasuredAt: MEASURED_AT,
  },
  {
    name: 'coverage-erosion',
    measuredVersion: '1.1.0',
    precision: 0.0,
    recall: null,
    firingCount: 4,
    corpus: CORPUS,
    lastMeasuredAt: MEASURED_AT,
  },
  {
    name: 'test-relaxation',
    measuredVersion: '1.1.0',
    precision: 0.0,
    recall: null,
    firingCount: 4,
    corpus: CORPUS,
    lastMeasuredAt: MEASURED_AT,
  },
  {
    name: 'comment-only-fix',
    measuredVersion: '1.0.0',
    precision: null,
    recall: 0.0,
    firingCount: 0,
    corpus: CORPUS,
    lastMeasuredAt: MEASURED_AT,
  },
  {
    name: 'exception-rethrow-lost-context',
    measuredVersion: '1.0.0',
    precision: null,
    recall: null,
    firingCount: 0,
    corpus: CORPUS,
    lastMeasuredAt: MEASURED_AT,
  },
  {
    name: 'dead-branch-insertion',
    measuredVersion: '1.0.0',
    precision: null,
    recall: null,
    firingCount: 0,
    corpus: CORPUS,
    lastMeasuredAt: MEASURED_AT,
  },
];

export function lookupPrecision(name: CheatCategory): DetectorPrecision | undefined {
  return TABLE.find((row) => row.name === name);
}

/**
 * Human-readable badge fragment, e.g.
 *   "precision 0.19 (3/16) on real-corpus-v10.1"
 *   "unmeasured"
 *   "did not fire on real-corpus-v10.1"
 *
 * The renderer uses the badge as a one-liner inside every PR-comment
 * finding header so a reviewer can read the measured number every
 * time a finding fires without leaving the comment.
 */
export function formatPrecisionBadge(name: CheatCategory): string {
  const row = lookupPrecision(name);
  if (row === undefined) return 'unmeasured (no published baseline yet)';
  if (row.precision === null) {
    return `did not fire on ${row.corpus}; no precision yet`;
  }
  const pct = row.precision.toFixed(2);
  const tp = Math.round(row.precision * row.firingCount);
  return `precision ${pct} (${tp}/${row.firingCount}) on ${row.corpus}`;
}

export function allDetectorPrecisions(): readonly DetectorPrecision[] {
  return TABLE;
}
