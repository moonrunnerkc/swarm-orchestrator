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
import type { DispatchDecision, FalsifierScheduler } from './scheduler';

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
  /**
   * Optional adaptive scheduler. When supplied, the dispatcher orders
   * the candidate adapters via `scheduler.order()` instead of
   * registration order, and feeds each call's outcome back via
   * `scheduler.recordOutcome()`. Stats persistence is the caller's
   * responsibility (call `scheduler.flush()` once per run).
   */
  readonly scheduler?: FalsifierScheduler;
  /**
   * Cooperative cancellation hook. Polled before each adapter call;
   * when it returns a string, the dispatcher returns immediately with
   * the calls accumulated so far. Used to honor `--cost-cap` mid-batch.
   */
  readonly shouldCancel?: () => string | null;
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
  /**
   * Decision recorded by the scheduler when one was supplied. Absent
   * when the dispatcher fell back to registration order.
   */
  readonly dispatchDecision?: DispatchDecision;
  /** Reason the dispatcher returned early (cost cap, cancellation). */
  readonly cancelled?: string;
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
  let decision: DispatchDecision | undefined;
  let ordered = adapters;
  if (options.scheduler && adapters.length > 0) {
    decision = options.scheduler.order(adapters);
    const byName = new Map(adapters.map((a) => [a.name, a]));
    ordered = decision.order
      .map((n) => byName.get(n))
      .filter((a): a is (typeof adapters)[number] => a !== undefined);
  }
  for (const adapter of ordered) {
    const cancel = options.shouldCancel?.() ?? null;
    if (cancel !== null) {
      const out: DispatcherOutcome = { disabled: false, calls, cancelled: cancel };
      if (decision) (out as { dispatchDecision?: DispatchDecision }).dispatchDecision = decision;
      return out;
    }
    const startMs = Date.now();
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
    if (options.scheduler) {
      options.scheduler.recordOutcome(adapter.name, {
        successful: outcome.result.kind === 'counter-example-input',
        costUsd: outcome.cost.dollarsApiEquivalent,
        latencyMs: Date.now() - startMs,
      });
    }
  }
  const result: DispatcherOutcome = { disabled: false, calls };
  if (decision) (result as { dispatchDecision?: DispatchDecision }).dispatchDecision = decision;
  return result;
}
