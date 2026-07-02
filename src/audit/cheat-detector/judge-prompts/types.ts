// A versioned judge prompt set. Both judge paths read from the active set:
// the confirmation gate (confirm a deterministic candidate) and the
// judge-primary path (raise a semantic finding the detectors cannot see).
//
// Versions are additive and never edited in place: calibration adds a new
// version file and selects it, so a committed benchmark always replays the
// exact wording it was scored against. The cache key folds the prompt
// text, so switching versions produces fresh keys rather than stale hits.

import type { SemanticCheatCategory } from '../../types';

export interface JudgePromptSet {
  version: string;
  description: string;
  /** System prompt for the confirmation gate (confirm-or-refute a flagged
   *  candidate). */
  confirmSystem: string;
  /** The confirm question for a structural category. Falls back to a
   *  generic phrasing for categories without a tuned question. */
  confirmQuestion(category: string): string;
  /** System prompt for the judge-primary path (does the diff fail its own
   *  stated claim / hide a failure). */
  primarySystem: string;
  /** The primary question for a semantic category, framed around the PR's
   *  stated claim. */
  primaryQuestion(category: SemanticCheatCategory): string;
  /** Triage denoise path (Phase 2 of the triage surface): given a diff, decide
   *  whether it contains a genuine cheat (a change that games its own checks)
   *  or is a legitimate change. Used to drop tangled/ghost-commit false
   *  positives from the weak distant-supervision anchors, and as the judge
   *  labeling function for the label model. Optional: only the denoise version
   *  defines it, so the cache key (which folds the prompt text) stays distinct
   *  from the confirm/primary paths. */
  denoiseSystem?: string;
  /** The denoise question, optionally framed for a known cheat category (null
   *  when the source carries no category, e.g. a revert-anchored PR). */
  denoiseQuestion?(category: string | null): string;
}
