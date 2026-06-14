// Shared types for the triage surface: a self-labeled, ranked, calibrated
// layer over the cheat detectors. The pipeline mines its own labels from
// distant supervision (Phase 1), denoises them with the judge (Phase 2),
// fuses the detectors and judge into a probabilistic label (Phase 3),
// ranks (Phase 4), and flags only above a conformal threshold (Phase 5).
//
// These types are the contract every phase reads and writes. They carry
// provenance and a reliability tier on every instance so the label model
// can weight sources by measured accuracy rather than by hand.

/** PU framing: a positive is objectively bad (proven, injected, or
 *  retrospectively reverted); everything else is unlabeled, NOT clean. */
export type TriageLabel = 'positive' | 'unlabeled';

/**
 * The provenance tier of a label, ordered from most to least reliable.
 * Phase 0 measured that the revert tier does not correlate with cheating in
 * aggregate, so it is carried as a weak source the label model down-weights,
 * never as ground truth.
 */
export type LabelTier =
  /** An injected cheat from the in-repo oracle. Ground truth, sha256-pinned. */
  | 'oracle-injected'
  /** A real PR with a per-instance execution-grounded tamper/restoration proof. */
  | 'restoration-proof'
  /** A real PR proven retrospectively bad by a revert or hotfix. Weak: Phase 0
   *  showed it tracks regression-proneness, not cheating. */
  | 'revert-weak'
  /** A presumed-clean merged PR. Unlabeled under PU, used as the negative pool
   *  for evaluation because a merged PR is presumed clean. */
  | 'clean-presumed';

/** The reliability weight prior for each tier, in [0, 1]. The label model
 *  learns accuracies from agreement; these are only the documented ordering,
 *  used for tie-breaking and reporting, never as a hand-tuned final weight. */
export const TIER_PRIOR: Readonly<Record<LabelTier, number>> = {
  'oracle-injected': 1.0,
  'restoration-proof': 0.95,
  'revert-weak': 0.2,
  'clean-presumed': 0.0,
};

/** One PR-sized instance in the triage dataset. The diff is held by reference
 *  (a repo-relative path plus a sha256) so the dataset file stays small and
 *  byte-stable; the sha256 pins the exact diff the label was derived from. */
export interface TriageInstance {
  /** Stable, unique id: `<tier>:<source-slug>`. Deterministic across runs. */
  readonly id: string;
  readonly label: TriageLabel;
  readonly tier: LabelTier;
  /** The cheat category, when the source carries one (oracle, restoration). */
  readonly category: string | null;
  /** The source PR url when known, else the synthetic oracle source url. */
  readonly sourcePrUrl: string;
  /** Repo-relative path to the diff this instance scores. */
  readonly diffPath: string;
  /** sha256 over the diff content at mining time. Pins reproducibility. */
  readonly sha256: string;
}

/** The mined dataset: instances plus a corpus digest over all of them, so a
 *  rebuild can be byte-compared the way the oracle corpus is. */
export interface TriageDataset {
  readonly schemaVersion: number;
  /** Counts per tier and label, for the report and quick sanity checks. */
  readonly summary: {
    readonly total: number;
    readonly positives: number;
    readonly unlabeled: number;
    readonly byTier: Readonly<Record<LabelTier, number>>;
  };
  /** sha256 over the deterministic instance list. Byte-stable across rebuilds. */
  readonly corpusSha256: string;
  readonly instances: readonly TriageInstance[];
}
