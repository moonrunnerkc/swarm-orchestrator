/**
 * Phase 6: pre-generation verification.
 *
 * Walk every contract obligation and check whether the live workspace
 * already satisfies it. Distinct from Phase 4 memoization: memoization
 * consults the prior ledger (was this obligation satisfied in a prior
 * run?), pre-generation consults disk and the build/test commands (is
 * this obligation already satisfied right now, possibly because some
 * earlier obligation already satisfied it incidentally?).
 *
 * Synthesis cost saved is the cost of every candidate the obligation
 * would have triggered; the population manager records an
 * `obligation-pre-verified` ledger entry per skip so the audit trail is
 * symmetric with the deterministic / memoized paths.
 *
 * See `v8-overhaul-guide.md` §5.5 (multi-point verification) and
 * `v8-implementation-guide.md` §9 (Phase 6 deliverables).
 */

import type { ObligationV1 } from '../contract/types';
import { verifyObligation, type VerifyOptions } from './run-verifier';

/** Single obligation's pre-generation result. */
export interface PreGenerationCheck {
  obligationIndex: number;
  obligation: ObligationV1;
  satisfied: boolean;
  detail: string;
}

/** Aggregate pre-generation verification result. */
export interface PreGenerationResult {
  /** Per-obligation results, parallel to the contract obligation list. */
  checks: PreGenerationCheck[];
  /** Indexes that were already satisfied; the manager skips these. */
  satisfiedIndexes: ReadonlySet<number>;
}

export interface PreGenerationOptions {
  obligations: readonly ObligationV1[];
  /** Indexes the manager has already excluded (memoized / deterministic). */
  skipIndexes?: ReadonlySet<number>;
  /** Verifier options (repoRoot, command timeout). */
  verifyOptions: VerifyOptions;
}

/**
 * Pre-verify every obligation that isn't already excluded. Returns the
 * set of indexes that already pass; the population manager unions this
 * with its memoized / deterministic skips before driving the synthesis
 * loop.
 *
 * For obligations whose verification is expensive (build-must-pass,
 * test-must-pass), the call still runs the command. Phase 6 makes a
 * deliberate trade: paying the verifier once up front avoids paying for
 * an entire generation tournament when the workspace is already green.
 * The manager should pass `skipIndexes` for any obligation already
 * resolved by deterministic / memoized paths so we never double-pay.
 */
export function preVerifyObligations(
  options: PreGenerationOptions,
): PreGenerationResult {
  const skip = options.skipIndexes ?? new Set<number>();
  const checks: PreGenerationCheck[] = [];
  const satisfied = new Set<number>();
  for (let i = 0; i < options.obligations.length; i += 1) {
    const o = options.obligations[i];
    if (!o) continue;
    if (skip.has(i)) continue;
    const result = verifyObligation(o, options.verifyOptions);
    checks.push({
      obligationIndex: i,
      obligation: o,
      satisfied: result.satisfied,
      detail: result.detail,
    });
    if (result.satisfied) satisfied.add(i);
  }
  return { checks, satisfiedIndexes: satisfied };
}
