/**
 * Type definitions for the v8 Phase 5 WASM deterministic floor.
 *
 * Each `DeterministicStrategy` is a side-effecting transformation that
 * satisfies one or more obligation types by editing the workspace. The
 * runtime sandboxes its execution: writes outside `repoRoot` are
 * rejected, an explicit time budget is enforced, and a per-call scratch
 * directory is provided for temporary files.
 *
 * See `v8-implementation-guide.md` §8 and `v8-overhaul-guide.md` §5.6.
 */

import type { ObligationType, ObligationV1 } from '../contract/types';

/**
 * Per-dispatch context handed to a strategy. The strategy operates on
 * `repoRoot` only; any write outside that directory is rejected by the
 * sandbox before it lands on disk.
 */
export interface StrategyContext {
  /** The obligation being satisfied. */
  obligation: ObligationV1;
  /** Absolute path to the repository root. */
  repoRoot: string;
  /** Absolute path to a per-dispatch scratch directory. */
  scratch: string;
  /** Soft wall-time budget, ms. Strategies should self-abort when exceeded. */
  timeoutMs: number;
}

/**
 * Result returned by a strategy's `execute`. Strategies may also throw
 * to signal a hard failure; the runtime catches and surfaces both shapes
 * uniformly to the population manager.
 */
export interface StrategyResult {
  /** True when the strategy applied its transformation; false skips. */
  applied: boolean;
  /** Free-form note for the audit trail. One short sentence. */
  detail: string;
  /** Repo-relative paths the strategy wrote or modified. May be empty. */
  filesAffected: string[];
}

/**
 * A deterministic strategy registered with the WASM runtime. The
 * strategy name appears in the contract obligation's
 * `deterministicStrategy` tag and in the ledger entries that record its
 * dispatch.
 */
export interface DeterministicStrategy {
  /** Stable name used in the contract tag. */
  name: string;
  /** Obligation types this strategy can satisfy. */
  handles: readonly ObligationType[];
  /** One-line description for ledger / debug output. */
  description: string;
  /** Execute the strategy. Must not write outside `ctx.repoRoot`. */
  execute(ctx: StrategyContext): Promise<StrategyResult>;
}

/**
 * Outcome of a runtime dispatch. `applied` mirrors the strategy's
 * return value; on failure the runtime captures the error message.
 */
export interface DispatchOutcome {
  /** Strategy that ran. */
  strategyName: string;
  /** Did the strategy apply its transformation? */
  applied: boolean;
  /** Repo-relative paths affected. */
  filesAffected: string[];
  /** Human-readable detail. */
  detail: string;
  /** Wall time spent, ms. */
  wallTimeMs: number;
  /** Error captured when the strategy threw; null otherwise. */
  error: string | null;
}
