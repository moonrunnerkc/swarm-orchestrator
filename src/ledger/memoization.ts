// The ledger is a memoization cache by construction (impl guide §7).
// Two paths:
//   - prior-run obligation skip on resume against the same contractHash.
//   - in-run candidate-hash dedup inside a tournament round.

import type {
  LedgerEntry,
  ObligationMemoizedEntry,
  RunStartedEntry,
  TournamentWinnerSelectedEntry,
} from './types';
import type { ObligationV1, ObligationType } from '../contract/types';

// Two obligations with the same key MUST have identical effect on the
// workspace; memoization correctness counts on this.
export function obligationKey(obligation: ObligationV1): string {
  switch (obligation.type) {
    case 'file-must-exist':
      return `${obligation.type}|${obligation.path}`;
    case 'build-must-pass':
    case 'test-must-pass':
      return `${obligation.type}|${obligation.command}`;
    case 'function-must-have-signature':
      return `${obligation.type}|${obligation.file}|${obligation.name}|${obligation.signature}`;
    case 'property-must-hold':
      return `${obligation.type}|${obligation.target}|${obligation.predicate}`;
    case 'import-graph-must-satisfy':
      return `${obligation.type}|${obligation.scope}|${obligation.constraint}`;
    case 'coverage-must-exceed':
      return `${obligation.type}|${obligation.scope}|${obligation.metric}|${obligation.threshold}`;
    case 'performance-must-not-regress':
      return `${obligation.type}|${obligation.benchmark}|${obligation.baseline}|${obligation.threshold}`;
  }
}

export interface MemoizationHit {
  source: 'prior-run' | 'prior-winner';
  origin: LedgerEntry;
  responseSha256: string | null;
  detail: string;
}

// Construction is O(N) over entries; findPriorWinnerByHash is O(1).
export class MemoStore {
  private readonly hashesByType: Map<ObligationType, Set<string>> = new Map();
  private readonly winnerByHash: Map<string, TournamentWinnerSelectedEntry> = new Map();

  constructor(entries: readonly LedgerEntry[] = []) {
    this.rebuild(entries);
  }

  rebuild(entries: readonly LedgerEntry[]): void {
    this.hashesByType.clear();
    this.winnerByHash.clear();
    // Track type-by-(runId, obligationIndex) so by the time we see a
    // winner we know its obligation type.
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

  ingest(entry: LedgerEntry): void {
    if (entry.type === 'tournament-winner-selected') {
      // No obligation type available here; index by hash only. Safe
      // because findPriorWinnerByHash filters by type lookup.
      this.winnerByHash.set(entry.responseSha256, entry);
    }
  }

  ingestWinner(entry: TournamentWinnerSelectedEntry, obligationType: ObligationType): void {
    let set = this.hashesByType.get(obligationType);
    if (!set) {
      set = new Set();
      this.hashesByType.set(obligationType, set);
    }
    set.add(entry.responseSha256);
    this.winnerByHash.set(entry.responseSha256, entry);
  }

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

  winnerCount(): number {
    return this.winnerByHash.size;
  }

  hashesIndexedCount(): number {
    let total = 0;
    for (const set of this.hashesByType.values()) total += set.size;
    return total;
  }
}

// `excludeRunId` skips the run currently resuming-into so we don't
// loop on our own partial state.
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
      // Failed obligations are not memoizable; last status wins per run.
      failed.add(`${e.runId}|${e.obligationIndex}`);
      satisfied.delete(e.obligationIndex);
    }
  }
  return satisfied;
}

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
  // Last status wins per (run, index).
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

export function hitFromMemoized(entry: ObligationMemoizedEntry): MemoizationHit {
  return {
    source: 'prior-run',
    origin: entry,
    responseSha256: entry.responseSha256,
    detail: entry.detail,
  };
}
