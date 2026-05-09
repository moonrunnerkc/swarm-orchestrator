/**
 * Sequential falsification dispatcher.
 *
 * Phase 1 keeps the dispatcher minimal: one adapter at a time, in
 * registration order, no scheduling, no bandit. The `--falsifiers off`
 * feature flag short-circuits the dispatcher entirely so production runs
 * can disable falsification without removing adapter code from the tree.
 *
 * The dispatcher does not own time budgets, retries, or cost caps —
 * those flow in via `DispatcherOptions`. Future phases extend this
 * function additively (Phase 5 introduces bandit selection by replacing
 * the in-loop registry traversal); the public signature stays stable.
 */

import type { ObligationV1 } from '../contract/types';
import type { AdapterRegistry } from './adapters/registry';
import type { AdapterCostRecord, FalsificationResult, FalsifyOutcome } from './adapters/types';

/** Toggle for `--falsifiers <on|off>`. Default `on`. */
export type FalsifiersFlag = 'on' | 'off';

export interface DispatcherOptions {
  readonly falsifiers: FalsifiersFlag;
  /** Wall-clock budget per adapter call. */
  readonly timeBudgetMs: number;
  /** Workspace already checked out at the patch SHA. */
  readonly workspaceRoot: string;
  /** Pointers passed through to each adapter unchanged. */
  readonly contextRefs: readonly string[];
  /** SHA of the patch under test. */
  readonly patchSha: string;
}

export interface DispatcherCallRecord {
  readonly adapterName: string;
  readonly result: FalsificationResult;
  readonly cost: AdapterCostRecord;
}

export interface DispatcherOutcome {
  readonly disabled: boolean;
  /** One entry per adapter call across all obligations dispatched. */
  readonly calls: readonly DispatcherCallRecord[];
}

/**
 * Run every registered adapter that handles `obligation.type` against the
 * obligation, sequentially. Returns immediately with `disabled: true` when
 * `options.falsifiers === 'off'`.
 */
export async function dispatchFalsifiers(
  obligation: ObligationV1,
  registry: AdapterRegistry,
  options: DispatcherOptions,
): Promise<DispatcherOutcome> {
  if (options.falsifiers === 'off') {
    return { disabled: true, calls: [] };
  }
  const adapters = registry.forObligation(obligation.type);
  const calls: DispatcherCallRecord[] = [];
  for (const adapter of adapters) {
    const outcome: FalsifyOutcome = await adapter.falsify({
      patchSha: options.patchSha,
      obligation,
      contextRefs: options.contextRefs,
      timeBudgetMs: options.timeBudgetMs,
      workspaceRoot: options.workspaceRoot,
    });
    calls.push({
      adapterName: adapter.name,
      result: outcome.result,
      cost: outcome.cost,
    });
  }
  return { disabled: false, calls };
}
