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
}
