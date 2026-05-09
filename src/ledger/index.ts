/**
 * Public surface of the v8 evidence ledger. Phase 4 ships an append-only
 * JSONL ledger with full hash-chain semantics, a memoization layer, and
 * a resume helper that derives population state from a partial run.
 */

export {
  HashChainedLedger,
  ChainTamperedError,
  GENESIS_PREV_HASH,
  canonicalJson,
  computeEntryHash,
  readEntries,
  verifyChainAt,
  verifyChainEntries,
} from './ledger';

// Back-compat alias used by Phase 2/3 call sites.
export { JsonlLedger } from './jsonl-ledger';

export {
  MemoStore,
  obligationKey,
  type MemoizationHit,
} from './memoization';

export {
  deriveResumeState,
  ResumeError,
  type ResumeState,
} from './resume';

export type {
  CandidateDiscardedEntry,
  CandidateRecordedEntry,
  CandidateStreamAbortedEntry,
  LedgerEntry,
  LedgerEntryHeader,
  LedgerEntryType,
  ObligationAttemptedEntry,
  ObligationDeterministicAppliedEntry,
  ObligationDeterministicAttemptedEntry,
  ObligationDeterministicFailedEntry,
  ObligationFailedEntry,
  ObligationMemoizedEntry,
  ObligationPreVerifiedEntry,
  ObligationSatisfiedEntry,
  PostMergeVerifiedEntry,
  RunFinishedEntry,
  RunResumedEntry,
  RunStartedEntry,
  TournamentEscalatedEntry,
  TournamentRoundStartedEntry,
  TournamentWinnerSelectedEntry,
} from './types';
