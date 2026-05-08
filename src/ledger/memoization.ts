/**
 * Phase 4 memoization layer. The ledger is a memoization cache by
 * construction (impl guide §7): every prior obligation result and every
 * prior tournament winner is captured by content hash. Before doing
 * synthesis work, we check whether an identical result already exists.
 *
 * Two memoization paths:
 *
 *   - **prior-run obligation skip**: when a run is resumed against the
 *     same ledger and the same contract (same `contractHash`), any
 *     obligation index already marked `obligation-satisfied` in a
 *     prior run is skipped. The resume CLI builds the index set via
 *     `priorSatisfiedIndexes` and the population manager honours the
 *     skip via the `skipObligationIndexes` option.
 *
 *   - **in-run candidate-hash dedup**: during a tournament round, if a
 *     candidate's response sha256 matches a prior `tournament-winner-
 *     selected` entry's sha256 for an obligation of the same type, the
 *     verifier call is skipped — the prior verdict is reused. Within a
 *     single round, two candidates that hash identically share one
 *     verifier call. In synthetic-bench mode, where the architect
 *     persona's response is content-deterministic per type, this is the
 *     dominant memoization path and what the §7 "share work across
 *     repeated patterns" exit criterion measures.
 *
 * The memoization scope is the ledger file itself. Callers wanting
 * cross-ledger memoization can compose a `MemoStore` from any list of
 * entries — the store is content-addressed.
 */

import type {
  LedgerEntry,
  ObligationMemoizedEntry,
  RunStartedEntry,
  TournamentWinnerSelectedEntry,
} from './types';
import type { ObligationV1, ObligationType } from '../contract/types';

/**
 * Build a stable string identity for an obligation. `file-must-exist`
 * obligations are keyed by path; `build-must-pass` and `test-must-pass`
 * by command. Two obligations with the same key MUST have identical
 * effect on the workspace, which is what memoization counts on.
 */
export function obligationKey(obligation: ObligationV1): string {
  if (obligation.type === 'file-must-exist') {
    return `${obligation.type}|${obligation.path}`;
  }
  return `${obligation.type}|${obligation.command}`;
}

/** Memoization hit, returned by the various lookup methods. */
export interface MemoizationHit {
  source: 'prior-run' | 'prior-winner';
  /** The originating ledger entry. */
  origin: LedgerEntry;
  /** Sha256 of the memoized response, when one was captured. */
  responseSha256: string | null;
  /** Free-form note suitable for the audit trail. */
  detail: string;
}

/**
 * Index of memoizable evidence built from a list of ledger entries.
 * Construction is O(N) over entries; `findPriorWinnerByHash` is O(1).
 */
export class MemoStore {
  /** Per-type set of response hashes that won a prior tournament. */
  private readonly hashesByType: Map<ObligationType, Set<string>> = new Map();
  /** Most recent winner entry per hash. */
  private readonly winnerByHash: Map<string, TournamentWinnerSelectedEntry> = new Map();

  constructor(entries: readonly LedgerEntry[] = []) {
    this.rebuild(entries);
  }

  /**
   * Rebuild the index from a fresh entry list. Callers using a
   * long-lived store call this when the underlying ledger grows.
   */
  rebuild(entries: readonly LedgerEntry[]): void {
    this.hashesByType.clear();
    this.winnerByHash.clear();
    // Pair each winner with the obligation type from the most recent
    // attempt for the same (runId, obligationIndex). Walk forward,
    // tracking type-by-index per run, so by the time we see a winner
    // we know its type.
    const typeByRunIndex = new Map<string, ObligationType>();
    for (const e of entries) {
      if (e.type === 'obligation-attempted') {
        typeByRunIndex.set(`${e.runId}|${e.obligationIndex}`, e.obligationType as ObligationType);
      } else if (e.type === 'tournament-round-started') {
        typeByRunIndex.set(`${e.runId}|${e.obligationIndex}`, e.obligationType as ObligationType);
      } else if (e.type === 'tournament-winner-selected') {
        const t = typeByRunIndex.get(`${e.runId}|${e.obligationIndex}`);
        if (!t) continue;
        let set = this.hashesByType.get(t);
        if (!set) {
          set = new Set();
          this.hashesByType.set(t, set);
        }
        set.add(e.responseSha256);
        this.winnerByHash.set(e.responseSha256, e);
      }
    }
  }

  /**
   * Append a single entry to the index. The population manager calls
   * this for entries it appends mid-run so memoization across earlier
   * obligations within the same run is honoured.
   */
  ingest(entry: LedgerEntry): void {
    if (entry.type === 'tournament-winner-selected') {
      // We don't have direct access to the obligation type here — the
      // caller can pass the type explicitly via `ingestWinner`. This
      // catch-all path stores by hash but cannot index by type; it's
      // safe because `findPriorWinnerByHash` filters by type lookup.
      this.winnerByHash.set(entry.responseSha256, entry);
    }
  }

  /**
   * Append a winner entry plus the obligation type the winner satisfies.
   * Used by the population manager / tournament harness mid-run.
   */
  ingestWinner(entry: TournamentWinnerSelectedEntry, obligationType: ObligationType): void {
    let set = this.hashesByType.get(obligationType);
    if (!set) {
      set = new Set();
      this.hashesByType.set(obligationType, set);
    }
    set.add(entry.responseSha256);
    this.winnerByHash.set(entry.responseSha256, entry);
  }

  /**
   * Look up whether a given response hash was the winner of a prior
   * tournament for an obligation of the same type. Used by the
   * tournament harness to short-circuit verifier scoring.
   */
  findPriorWinnerByHash(
    obligation: ObligationV1,
    responseSha256: string,
  ): MemoizationHit | null {
    const set = this.hashesByType.get(obligation.type);
    if (!set || !set.has(responseSha256)) return null;
    const w = this.winnerByHash.get(responseSha256);
    if (!w) return null;
    return {
      source: 'prior-winner',
      origin: w,
      responseSha256,
      detail: `response hash ${responseSha256.slice(0, 12)}… won prior tournament at run ${w.runId} seq ${w.seq}`,
    };
  }

  /** Number of unique winner response hashes tracked. */
  winnerCount(): number {
    return this.winnerByHash.size;
  }

  /** Total per-type hash count (sum across all types). */
  hashesIndexedCount(): number {
    let total = 0;
    for (const set of this.hashesByType.values()) total += set.size;
    return total;
  }
}

/**
 * Compute the set of obligation indexes already satisfied by a prior
 * run sharing the same `contractHash`. Used by the resume CLI to skip
 * already-finished work without rerunning synthesis.
 *
 * Matching policy: the entry list is grouped by runId; runs whose
 * `run-started` entry declares a different contractHash are ignored;
 * runs flagged with `--exclude-run-id` are also ignored (used to skip
 * the run we're currently resuming-into so we don't loop on our own
 * partial state).
 *
 * An obligation index is "satisfied" when any prior eligible run has an
 * `obligation-satisfied` or `obligation-memoized` entry for that index.
 */
export function priorSatisfiedIndexes(
  entries: readonly LedgerEntry[],
  contractHash: string,
  options: { excludeRunId?: string } = {},
): Set<number> {
  const eligibleRuns = new Set<string>();
  for (const e of entries) {
    if (e.type === 'run-started') {
      const re = e as RunStartedEntry;
      if (re.contractHash === contractHash) eligibleRuns.add(re.runId);
    }
  }
  if (options.excludeRunId) eligibleRuns.delete(options.excludeRunId);
  const satisfied = new Set<number>();
  const failed = new Set<string>();
  for (const e of entries) {
    if (!eligibleRuns.has(e.runId)) continue;
    if (e.type === 'obligation-satisfied' || e.type === 'obligation-memoized') {
      satisfied.add(e.obligationIndex);
    } else if (e.type === 'obligation-failed') {
      // A failed obligation is *not* memoizable; on resume we want to
      // retry it. Track it in `failed` and remove from `satisfied` if
      // the order interleaves (last status wins per run).
      failed.add(`${e.runId}|${e.obligationIndex}`);
      satisfied.delete(e.obligationIndex);
    }
  }
  return satisfied;
}

/**
 * Compute the set of obligation indexes that previously failed and need
 * a fresh attempt on resume. Used by the resume CLI to surface "these
 * will be retried" so the user knows what to expect.
 */
export function priorFailedIndexes(
  entries: readonly LedgerEntry[],
  contractHash: string,
  options: { excludeRunId?: string } = {},
): Set<number> {
  const eligibleRuns = new Set<string>();
  for (const e of entries) {
    if (e.type === 'run-started') {
      const re = e as RunStartedEntry;
      if (re.contractHash === contractHash) eligibleRuns.add(re.runId);
    }
  }
  if (options.excludeRunId) eligibleRuns.delete(options.excludeRunId);
  const failed = new Set<number>();
  // Per-(run,index) "last status seen" so a satisfied-after-failed
  // sequence doesn't leave the index in `failed`.
  const lastStatus = new Map<string, 'satisfied' | 'failed' | 'memoized'>();
  for (const e of entries) {
    if (!eligibleRuns.has(e.runId)) continue;
    if (e.type === 'obligation-satisfied') {
      lastStatus.set(`${e.runId}|${e.obligationIndex}`, 'satisfied');
    } else if (e.type === 'obligation-failed') {
      lastStatus.set(`${e.runId}|${e.obligationIndex}`, 'failed');
    } else if (e.type === 'obligation-memoized') {
      lastStatus.set(`${e.runId}|${e.obligationIndex}`, 'memoized');
    }
  }
  for (const [k, v] of lastStatus) {
    if (v === 'failed') {
      const idx = Number.parseInt(k.split('|')[1] ?? '-1', 10);
      if (Number.isFinite(idx) && idx >= 0) failed.add(idx);
    }
  }
  return failed;
}

/**
 * Convenience: build a memoization-hit object from a memoized entry.
 * Used by tests that want to round-trip an `ObligationMemoizedEntry`
 * through the lookup API.
 */
export function hitFromMemoized(entry: ObligationMemoizedEntry): MemoizationHit {
  return {
    source: 'prior-run',
    origin: entry,
    responseSha256: entry.responseSha256,
    detail: entry.detail,
  };
}
