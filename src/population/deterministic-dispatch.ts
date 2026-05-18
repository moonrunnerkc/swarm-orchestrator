/**
 * Deterministic-floor dispatch for a single obligation.
 *
 * §8 misclassification recovery: never retries a failing strategy.
 * The caller tracks attempted indexes and reroutes to synthesis.
 * Extracted from manager.ts to keep the main loop focused on
 * scheduling while WASM dispatch details live in their own module.
 */

import type { ObligationV1 } from '../contract/types';
import type { JsonlLedger } from '../ledger/jsonl-ledger';
import type {
  ObligationDeterministicAppliedEntry,
  ObligationDeterministicAttemptedEntry,
  ObligationDeterministicFailedEntry,
  ObligationSatisfiedEntry,
} from '../ledger/types';
import type { WasmRuntime } from '../wasm/wasm-runtime';
import { verifyObligation } from '../verification/run-verifier';
import { getLogger } from '../logger';

const _log = getLogger('population.deterministic-dispatch');

export interface DispatchDeterministicFloorResult {
  applied: boolean;
  detail: string;
}

/**
 * Dispatch an obligation through its WASM deterministic strategy.
 * Returns `{ applied: true }` when the strategy applied AND verified;
 * `{ applied: false }` on any failure (error, not-applied, verifier-rejected).
 * The caller records the outcome in the state builder and decides
 * whether to count the obligation as satisfied or reroute to synthesis.
 */
export async function dispatchDeterministicFloor(
  obligationIndex: number,
  obligation: ObligationV1,
  wasmRuntime: WasmRuntime,
  repoRoot: string,
  ledger: JsonlLedger,
  commandTimeoutMs?: number,
  strategyTimeoutMs?: number,
): Promise<DispatchDeterministicFloorResult> {
  const strategyName = obligation.deterministicStrategy ?? '';

  ledger.append<ObligationDeterministicAttemptedEntry>({
    type: 'obligation-deterministic-attempted',
    obligationIndex,
    obligationType: obligation.type,
    strategyName,
  });

  const dispatchOpts: { strategyName?: string; timeoutMs?: number } = {};
  if (strategyTimeoutMs !== undefined) dispatchOpts.timeoutMs = strategyTimeoutMs;
  const outcome = await wasmRuntime.dispatch(obligation, repoRoot, dispatchOpts);

  if (outcome.error !== null) {
    ledger.append<ObligationDeterministicFailedEntry>({
      type: 'obligation-deterministic-failed',
      obligationIndex,
      obligationType: obligation.type,
      strategyName,
      reason: 'error',
      detail: outcome.detail,
    });
    return { applied: false, detail: outcome.detail };
  }

  if (!outcome.applied) {
    ledger.append<ObligationDeterministicFailedEntry>({
      type: 'obligation-deterministic-failed',
      obligationIndex,
      obligationType: obligation.type,
      strategyName,
      reason: 'not-applied',
      detail: outcome.detail,
    });
    return { applied: false, detail: outcome.detail };
  }

  const verifyOpts: Parameters<typeof verifyObligation>[1] = { repoRoot };
  if (commandTimeoutMs !== undefined) verifyOpts.commandTimeoutMs = commandTimeoutMs;
  const verifyResult = verifyObligation(obligation, verifyOpts);
  if (!verifyResult.satisfied) {
    ledger.append<ObligationDeterministicFailedEntry>({
      type: 'obligation-deterministic-failed',
      obligationIndex,
      obligationType: obligation.type,
      strategyName,
      reason: 'verifier-rejected',
      detail: `${outcome.detail}; verifier said: ${verifyResult.detail}`,
    });
    return { applied: false, detail: verifyResult.detail };
  }

  ledger.append<ObligationDeterministicAppliedEntry>({
    type: 'obligation-deterministic-applied',
    obligationIndex,
    obligationType: obligation.type,
    strategyName,
    filesAffected: outcome.filesAffected,
    wallTimeMs: outcome.wallTimeMs,
    detail: outcome.detail,
  });
  ledger.append<ObligationSatisfiedEntry>({
    type: 'obligation-satisfied',
    obligationIndex,
    obligationType: obligation.type,
    detail: `deterministic ${strategyName}: ${outcome.detail}`,
  });
  return { applied: true, detail: outcome.detail };
}