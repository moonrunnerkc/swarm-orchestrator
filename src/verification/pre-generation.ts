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

// Obligation types whose verification result depends on the integrated
// state of the workspace. Pre-verifying these while another synthesis
// obligation is still pending is unsound — the pending obligation can
// flip the global-state verifier's outcome, producing vacuous
// "pre-verified" entries that post-merge then has to revoke (May 2026
// eval failure: `node --test` exited 0 against an empty repo for a
// contract that required a test file be added).
//
// Local-state obligation types (file-must-exist,
// function-must-have-signature, import-graph-must-satisfy) are pure
// functions of files already on disk, so pending obligations can't
// invalidate them.
const GLOBAL_STATE_OBLIGATION_TYPES: ReadonlySet<ObligationV1['type']> = new Set([
  'build-must-pass',
  'test-must-pass',
  'property-must-hold',
  'coverage-must-exceed',
  'performance-must-not-regress',
]);

// Soundness rule: a global-state obligation is only pre-verified when
// **no other** non-excluded local-state obligation remains pending. The
// partition below scans obligations once into local-state and
// global-state buckets; pass 1 evaluates local-state unconditionally,
// pass 2 evaluates global-state only when every local-state index is
// satisfied (by pass 1 or the manager's pre-passes).
export function preVerifyObligations(
  options: PreGenerationOptions,
): PreGenerationResult {
  const skip = options.skipIndexes ?? new Set<number>();
  const checks: PreGenerationCheck[] = [];
  const satisfied = new Set<number>();
  const localIndexes: number[] = [];
  const globalIndexes: number[] = [];

  for (let i = 0; i < options.obligations.length; i += 1) {
    const o = options.obligations[i];
    if (!o) continue;
    if (skip.has(i)) continue;
    if (GLOBAL_STATE_OBLIGATION_TYPES.has(o.type)) globalIndexes.push(i);
    else localIndexes.push(i);
  }

  const runCheck = (i: number): void => {
    const o = options.obligations[i];
    if (!o) return;
    const result = verifyObligation(o, options.verifyOptions);
    checks.push({
      obligationIndex: i,
      obligation: o,
      satisfied: result.satisfied,
      detail: result.detail,
    });
    if (result.satisfied) satisfied.add(i);
  };

  for (const i of localIndexes) runCheck(i);

  // If any local-state obligation is still pending after pass 1, the
  // global-state verifier's outcome is not stable; defer.
  const allLocalSatisfied = localIndexes.every((i) => satisfied.has(i));
  if (allLocalSatisfied) {
    for (const i of globalIndexes) runCheck(i);
  }

  return { checks, satisfiedIndexes: satisfied };
}
