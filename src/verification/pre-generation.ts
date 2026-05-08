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
 * Obligation types whose verification result depends on the integrated
 * state of the workspace. A `build-must-pass` may pass on an empty
 * scaffold, then fail once a synthesis obligation lands a malformed test
 * file. Pre-verifying these without checking that no other obligation is
 * pending is unsound: it produces vacuous "satisfied" results that the
 * post-merge integration check will then have to flip back to "failed",
 * making pre-gen actively misleading rather than informative.
 *
 * Local-only obligation types (`file-must-exist`,
 * `function-must-have-signature`, `import-graph-must-satisfy`) are
 * unaffected: their truth value is a pure function of files already on
 * disk, so a pending obligation creating a different file does not
 * invalidate them.
 */
const GLOBAL_STATE_OBLIGATION_TYPES: ReadonlySet<ObligationV1['type']> = new Set([
  'build-must-pass',
  'test-must-pass',
  'property-must-hold',
  'coverage-must-exceed',
  'performance-must-not-regress',
]);

/**
 * Pre-verify every obligation that isn't already excluded. Returns the
 * set of indexes that already pass; the population manager unions this
 * with its memoized / deterministic skips before driving the synthesis
 * loop.
 *
 * Soundness rule: a `global-state` obligation (build / test / property /
 * coverage / performance) is only pre-verified when **no other** non-
 * excluded obligation remains pending. If any synthesis obligation is
 * still queued, that obligation could land a change that flips the
 * global-state verifier's outcome, so we defer the check to its normal
 * dispatch position. Local-state obligations (file-must-exist,
 * function-must-have-signature, import-graph-must-satisfy) are pre-
 * verified eagerly because no other obligation can invalidate a "this
 * file already exists" result.
 *
 * The two-pass split is deliberate: pass 1 evaluates local-state
 * obligations and discovers which global-state obligations are still
 * pending; pass 2 evaluates global-state obligations only when nothing
 * else remains pending after pass 1. Without this split the manager
 * would observe vacuous "pre-verified" entries (e.g. `node --test` exits
 * 0 against an empty repo even though the contract requires a test file
 * be added later), which is exactly the failure mode this rewrite fixes.
 */
export function preVerifyObligations(
  options: PreGenerationOptions,
): PreGenerationResult {
  const skip = options.skipIndexes ?? new Set<number>();
  const checks: PreGenerationCheck[] = [];
  const satisfied = new Set<number>();

  const candidates: number[] = [];
  for (let i = 0; i < options.obligations.length; i += 1) {
    if (!options.obligations[i]) continue;
    if (skip.has(i)) continue;
    candidates.push(i);
  }

  // Pass 1: evaluate local-state obligations. These are safe to pre-verify
  // unconditionally because their outcome can't be invalidated by other
  // pending obligations.
  for (const i of candidates) {
    const o = options.obligations[i];
    if (!o) continue;
    if (GLOBAL_STATE_OBLIGATION_TYPES.has(o.type)) continue;
    const result = verifyObligation(o, options.verifyOptions);
    checks.push({
      obligationIndex: i,
      obligation: o,
      satisfied: result.satisfied,
      detail: result.detail,
    });
    if (result.satisfied) satisfied.add(i);
  }

  // Pass 2: evaluate global-state obligations only if every other
  // non-excluded obligation has already been satisfied (by pass 1, by
  // the manager's memoization/deterministic pre-passes, or by the skip
  // set). When at least one synthesis obligation is still pending, the
  // global-state verifier's outcome is not stable, so we record nothing
  // and let the obligation flow through normal dispatch.
  const stillPending = (): boolean =>
    candidates.some((idx) => {
      const o = options.obligations[idx];
      if (!o) return false;
      if (satisfied.has(idx)) return false;
      // Other global-state obligations don't block each other; only
      // not-yet-satisfied LOCAL synthesis work blocks pass 2. Once the
      // local obligations are all satisfied, the global obligations are
      // ready to be checked against the integrated workspace.
      return !GLOBAL_STATE_OBLIGATION_TYPES.has(o.type);
    });

  if (!stillPending()) {
    for (const i of candidates) {
      const o = options.obligations[i];
      if (!o) continue;
      if (!GLOBAL_STATE_OBLIGATION_TYPES.has(o.type)) continue;
      const result = verifyObligation(o, options.verifyOptions);
      checks.push({
        obligationIndex: i,
        obligation: o,
        satisfied: result.satisfied,
        detail: result.detail,
      });
      if (result.satisfied) satisfied.add(i);
    }
  }

  return { checks, satisfiedIndexes: satisfied };
}
