/**
 * Phase 4 run-resumption helpers. Given a ledger file, derive the
 * population state needed to continue a partially-completed run without
 * redoing satisfied work.
 *
 * The resume protocol is deliberately conservative:
 *
 *   - Only obligations explicitly marked `obligation-satisfied` (or
 *     `obligation-memoized`) in a prior run with the SAME contractHash
 *     are considered satisfied. Same-run satisfactions count too — a
 *     resume against a partial in-place run is the common case.
 *   - Obligations marked `obligation-failed` are reset to `pending`;
 *     resume re-attempts them.
 *   - Tournaments-in-flight (a `tournament-round-started` entry without
 *     a matching winner/escalation) are treated as discarded; the
 *     obligation is `pending` again and the next run reruns it from
 *     scratch. The bound on cost is the round-cap-of-3 rule.
 *
 * The helpers here read the ledger and return the derived state; they
 * do not mutate the ledger. The caller (the resume CLI handler) is
 * responsible for writing a `run-resumed` marker entry before
 * dispatching the population manager.
 */

import type { FinalContract, ObligationV1 } from '../contract/types';
import type { LedgerEntry, RunStartedEntry } from './types';
import {
  obligationKey,
  priorSatisfiedIndexes,
  priorFailedIndexes,
} from './memoization';

/**
 * Snapshot of derived state suitable for feeding back into the
 * population manager. `pendingIndexes` is everything not satisfied;
 * `satisfiedIndexes` is what gets short-circuited via the
 * `obligation-memoized` path on resume.
 */
export interface ResumeState {
  /** The original run's id, taken from the most recent matching run-started entry. */
  resumeOf: string;
  /** Contract id reported by the run-started entry. */
  contractId: string;
  /** Contract hash reported by the run-started entry. */
  contractHash: string;
  /** Obligation indexes already satisfied; resume will short-circuit them. */
  satisfiedIndexes: Set<number>;
  /** Obligation indexes that previously failed; resume will retry them. */
  failedIndexes: Set<number>;
  /**
   * Obligation indexes still pending after the partial run — i.e.
   * everything in the contract that isn't satisfied. Failed indexes
   * are part of pending; the population manager attempts them on
   * resume.
   */
  pendingIndexes: Set<number>;
  /** Original obligation count from the run-started entry. */
  originalObligationCount: number;
}

/**
 * Error thrown when the ledger doesn't carry enough state to resume
 * cleanly. Distinct from `ChainTamperedError` which signals tamper.
 */
export class ResumeError extends Error {
  readonly code: 'no-run-started' | 'contract-hash-mismatch' | 'no-obligations';
  constructor(message: string, code: ResumeError['code']) {
    super(message);
    this.name = 'ResumeError';
    this.code = code;
  }
}

/**
 * Derive resume state from a list of ledger entries plus the contract
 * the caller wants to resume against. The contract serves two roles:
 *   - confirms the contractHash matches at least one prior run-started
 *     entry (otherwise resume is suspicious — different contract);
 *   - supplies the canonical obligation order so pending indexes line
 *     up correctly.
 */
export function deriveResumeState(
  entries: readonly LedgerEntry[],
  contract: FinalContract,
  options: { excludeRunId?: string } = {},
): ResumeState {
  const matchingStart = findLatestRunStarted(entries, contract.manifest.contractHash);
  if (!matchingStart) {
    const seenHashes = new Set<string>();
    for (const e of entries) {
      if (e.type === 'run-started') seenHashes.add((e as RunStartedEntry).contractHash);
    }
    throw new ResumeError(
      `no run-started entry matches contract hash ${contract.manifest.contractHash}; ledger contains ${[...seenHashes].join(', ') || '(none)'}`,
      'no-run-started',
    );
  }
  if (contract.obligations.length === 0) {
    throw new ResumeError('contract has no obligations to resume against', 'no-obligations');
  }
  const satisfied = priorSatisfiedIndexes(entries, contract.manifest.contractHash, options);
  const failed = priorFailedIndexes(entries, contract.manifest.contractHash, options);
  const pending = new Set<number>();
  for (let i = 0; i < contract.obligations.length; i += 1) {
    if (!satisfied.has(i)) pending.add(i);
  }
  return {
    resumeOf: matchingStart.runId,
    contractId: matchingStart.contractId,
    contractHash: matchingStart.contractHash,
    satisfiedIndexes: satisfied,
    failedIndexes: failed,
    pendingIndexes: pending,
    originalObligationCount: matchingStart.obligationCount,
  };
}

/**
 * Find the most recent `run-started` entry whose `contractHash` matches.
 * Multiple matching starts can occur (a contract has been resumed many
 * times); the last one wins.
 */
function findLatestRunStarted(
  entries: readonly LedgerEntry[],
  contractHash: string,
): RunStartedEntry | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i];
    if (!e) continue;
    if (e.type === 'run-started' && (e as RunStartedEntry).contractHash === contractHash) {
      return e as RunStartedEntry;
    }
  }
  return null;
}

/**
 * Walk the contract's obligation list and return the entries the caller
 * should write as `obligation-memoized` ledger entries on resume — one
 * per index in `state.satisfiedIndexes`. The returned shape is a
 * partial entry minus the header (the ledger stamps those).
 */
export function memoizedEntriesForResume(
  state: ResumeState,
  contract: FinalContract,
): Array<{
  type: 'obligation-memoized';
  obligationIndex: number;
  obligationType: string;
  obligationKey: string;
  source: 'prior-run';
  responseSha256: string | null;
  detail: string;
}> {
  const out: ReturnType<typeof memoizedEntriesForResume> = [];
  for (const idx of state.satisfiedIndexes) {
    const o = contract.obligations[idx];
    if (!o) continue;
    out.push({
      type: 'obligation-memoized',
      obligationIndex: idx,
      obligationType: o.type,
      obligationKey: keyForObligation(o),
      source: 'prior-run',
      responseSha256: null,
      detail: `obligation index ${idx} satisfied by prior run ${state.resumeOf}; skipping synthesis`,
    });
  }
  return out;
}

function keyForObligation(o: ObligationV1): string {
  // Delegate to memoization.obligationKey to avoid drift between the two
  // call sites; both paths land in the same key shape.
  return obligationKey(o);
}
