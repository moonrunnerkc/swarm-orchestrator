/**
 * Type definitions for the v8 evidence ledger. Phase 2 ships an append-only
 * JSONL ledger for run-time auditability. Phase 4 adds the IRONROOT-backed
 * hash chain on top; the entry shapes here are the union the Phase 4
 * implementation will continue to consume.
 *
 * See `v8-overhaul-guide.md` §5.4 (evidence ledger) and
 * `v8-implementation-guide.md` §7 (Phase 4).
 */

import type { SessionUsage } from '../session/types';

/** Common header fields every ledger entry carries. */
export interface LedgerEntryHeader {
  /** ISO-8601 UTC timestamp. */
  ts: string;
  /** Run id this entry belongs to. */
  runId: string;
  /** Monotonically increasing sequence number within the run. */
  seq: number;
}

/** Run started: contract id + initial obligation count. */
export interface RunStartedEntry extends LedgerEntryHeader {
  type: 'run-started';
  contractId: string;
  contractHash: string;
  obligationCount: number;
  goal: string;
}

/** Persona was selected to take on an obligation. */
export interface ObligationAttemptedEntry extends LedgerEntryHeader {
  type: 'obligation-attempted';
  obligationIndex: number;
  obligationType: string;
  personaId: string;
}

/** Persona produced a candidate response. */
export interface CandidateRecordedEntry extends LedgerEntryHeader {
  type: 'candidate-recorded';
  obligationIndex: number;
  personaId: string;
  /** Sha256 of the response text, hex. */
  responseSha256: string;
  /** Token usage of the call that produced this candidate. */
  usage: SessionUsage;
  model: string;
}

/** Verification of an obligation passed. */
export interface ObligationSatisfiedEntry extends LedgerEntryHeader {
  type: 'obligation-satisfied';
  obligationIndex: number;
  obligationType: string;
  /** Free-form note on how it was satisfied. */
  detail: string;
}

/** Verification of an obligation failed. */
export interface ObligationFailedEntry extends LedgerEntryHeader {
  type: 'obligation-failed';
  obligationIndex: number;
  obligationType: string;
  /** Human-readable failure summary. */
  detail: string;
}

/** Run finished. Always the last entry. */
export interface RunFinishedEntry extends LedgerEntryHeader {
  type: 'run-finished';
  satisfied: number;
  failed: number;
  totalUsage: SessionUsage;
}

/** Discriminated union of every Phase 2 ledger entry shape. */
export type LedgerEntry =
  | RunStartedEntry
  | ObligationAttemptedEntry
  | CandidateRecordedEntry
  | ObligationSatisfiedEntry
  | ObligationFailedEntry
  | RunFinishedEntry;

/** Type tag union for all ledger entries. */
export type LedgerEntryType = LedgerEntry['type'];
