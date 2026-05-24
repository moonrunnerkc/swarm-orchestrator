import type { ObligationV1 } from '../../src/contract/types';
import {
  effectiveInputTokens,
  type SessionUsage,
} from '../../src/session/types';

/**
 * Synthetic v6 cost model. The architectural premise of v6 is "each
 * agent is a separate CLI invocation, each invocation boots a fresh
 * agent context, re-loads tool definitions, re-authenticates, and
 * re-derives project understanding from scratch." The defaults below
 * are a deliberately conservative read of what v6 did in production.
 *
 * The model:
 *   - Each obligation is its own CLI invocation (no shared context, no
 *     prompt cache).
 *   - Per-invocation cost = bootstrapTokens + dynamicTokens (input) + outputTokens.
 *   - Repair-loop tax: 30% step failure rate × 3 retries per failed step ⇒
 *     0.9 retry cycles per obligation in expectation.
 *   - All retry cycles re-pay the bootstrap cost (no cache).
 *
 * The numbers below are §6's defaults. Callers may override for sensitivity
 * analysis.
 */
export interface V6Model {
  /** Tokens billed for context boot per CLI invocation. Default 40K (§6). */
  bootstrapTokens: number;
  /** Per-obligation dynamic input on top of bootstrap. Default 3K (§6). */
  dynamicTokens: number;
  /** Per-obligation output. Default 3K (§6). */
  outputTokens: number;
  /**
   * Expected extra retry cycles per obligation. Default 0.9 (30% × 3 from
   * VeriMAP retry economics, §4.2).
   */
  retryFactor: number;
}

export const DEFAULT_V6_MODEL: V6Model = {
  bootstrapTokens: 40_000,
  dynamicTokens: 3_000,
  outputTokens: 3_000,
  retryFactor: 0.9,
};

/** Compute the v6 SessionUsage equivalent for a contract. */
export function modelV6Usage(
  obligations: readonly ObligationV1[],
  model: V6Model = DEFAULT_V6_MODEL,
): SessionUsage {
  const n = obligations.length;
  // Primary attempts: n CLI invocations.
  const primaryInput = n * (model.bootstrapTokens + model.dynamicTokens);
  const primaryOutput = n * model.outputTokens;
  // Retry cycles: n × retryFactor extra attempts, each paying bootstrap again.
  const retryInput = n * model.retryFactor * (model.bootstrapTokens + model.dynamicTokens);
  const retryOutput = n * model.retryFactor * model.outputTokens;
  return {
    inputTokens: primaryInput + retryInput,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: primaryOutput + retryOutput,
  };
}

/**
 * Effective input tokens for a v6-modeled contract. Equivalent to
 * `effectiveInputTokens(modelV6Usage(...))` since v6 has no cache and the
 * cache multipliers are no-ops on it. Exposed as its own function so the
 * benchmark report can show the math without re-deriving usage.
 */
export function modelV6EffectiveInputTokens(
  obligations: readonly ObligationV1[],
  model: V6Model = DEFAULT_V6_MODEL,
): number {
  return effectiveInputTokens(modelV6Usage(obligations, model));
}
