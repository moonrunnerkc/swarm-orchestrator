/**
 * Public surface of the v8 evidence ledger. Phase 2 ships an append-only
 * JSONL implementation; Phase 4 layers IRONROOT-backed hash chaining and
 * memoization on top.
 */

export { JsonlLedger, readEntries } from './jsonl-ledger';
export type {
  CandidateDiscardedEntry,
  CandidateRecordedEntry,
  LedgerEntry,
  LedgerEntryHeader,
  LedgerEntryType,
  ObligationAttemptedEntry,
  ObligationFailedEntry,
  ObligationSatisfiedEntry,
  RunFinishedEntry,
  RunStartedEntry,
  TournamentEscalatedEntry,
  TournamentRoundStartedEntry,
  TournamentWinnerSelectedEntry,
} from './types';
