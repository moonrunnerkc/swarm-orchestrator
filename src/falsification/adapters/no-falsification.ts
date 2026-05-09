/**
 * Shared `no-falsification-found` result builder used by every adapter.
 *
 * The three built-in adapters (Codex, Copilot, ClaudeCode) each had a
 * private copy of this helper at one point; the duplicate-blocks
 * quality gate flagged the divergence-by-copy and the audit-and-
 * corrections sweep (DECISIONS.md 2026-05-09) extracted the shared
 * implementation into this module.
 */

import type { ObligationType } from '../../contract/types';
import type { NoFalsificationFoundResult } from './types';

export function noFalsification(
  obligationType: ObligationType,
  attempts: number,
  reason: 'time-budget-exhausted' | 'no-counter-example-discovered',
): NoFalsificationFoundResult {
  return {
    kind: 'no-falsification-found',
    obligationType,
    reason,
    attempts,
  };
}
