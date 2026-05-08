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
  /**
   * Phase 4: sha256 hex of the immediately-previous ledger entry's
   * `entryHash`. The genesis entry (seq 0 of the ledger file) carries
   * the all-zero digest. Tampering with any prior entry breaks the chain
   * and `verifyChain` rejects the file.
   */
  prevHash: string;
  /**
   * Phase 4: sha256 hex of the canonical JSON form of this entry with
   * `entryHash` itself excluded. Entries are independently re-derivable;
   * if the on-disk bytes are edited, the recomputed hash diverges.
   */
  entryHash: string;
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

/**
 * Phase 4: a previously-recorded run was resumed against the same ledger
 * file. The entry sits between the prior run-finished (or last entry of
 * an unfinished run) and the next obligation activity. Carries the
 * resumeOf reference so audits can follow a multi-run thread.
 */
export interface RunResumedEntry extends LedgerEntryHeader {
  type: 'run-resumed';
  contractId: string;
  contractHash: string;
  /** Run id the resume picks up from. Identical to runId when in-place. */
  resumeOf: string;
  /** Number of obligations already satisfied per the prior ledger state. */
  alreadySatisfied: number;
  /** Number of obligations still pending after replaying prior state. */
  pending: number;
}

/**
 * Phase 4: an obligation was satisfied by memoization rather than fresh
 * synthesis. Two memoization sources exist:
 *   - `prior-run`: an `obligation-satisfied` entry for an identical
 *     obligation key already exists from a prior run in this ledger.
 *   - `prior-winner`: the architect persona's response hashes to the
 *     same value as a prior tournament-winner-selected entry in the
 *     current run.
 * Either way, no synthesis call was made; only the apply step (when the
 * memoized response carries one) ran. Token cost is zero on the
 * synthesis side; the entry captures the saved usage for audit.
 */
export interface ObligationMemoizedEntry extends LedgerEntryHeader {
  type: 'obligation-memoized';
  obligationIndex: number;
  obligationType: string;
  /** Stable obligation key (`type|payload`). */
  obligationKey: string;
  source: 'prior-run' | 'prior-winner';
  /** Sha256 of the memoized response, when one was applied. */
  responseSha256: string | null;
  /** Free-form note for the audit trail. */
  detail: string;
}

/**
 * Phase 3: a tournament round started for an obligation. The same
 * obligationIndex may be revisited up to `roundCap` times; each round emits
 * its own entry so the ledger captures diversity-injection decisions.
 */
export interface TournamentRoundStartedEntry extends LedgerEntryHeader {
  type: 'tournament-round-started';
  obligationIndex: number;
  obligationType: string;
  roundIndex: number;
  /** Total rounds allowed for this obligation. */
  roundCap: number;
  /** Persona ids dispatched in this round, in order. */
  personaIds: string[];
  /** Sampling temperatures used per candidate, parallel to personaIds. */
  temperatures: number[];
}

/**
 * Phase 3: a candidate that lost the tournament. Its diff hash and token
 * cost are captured for cost attribution per impl guide §6 ("losing
 * candidates are logged to the ledger with full diff hash but never
 * applied. Their token cost is captured for cost attribution.").
 */
export interface CandidateDiscardedEntry extends LedgerEntryHeader {
  type: 'candidate-discarded';
  obligationIndex: number;
  roundIndex: number;
  candidateIndex: number;
  personaId: string;
  responseSha256: string;
  /** Verifier's structured score in [0, 1]; see verifier-persona.ts. */
  score: number;
  /** Verifier's brief rationale for the score. */
  rationale: string;
  /** Token usage attributed to this candidate's generation call. */
  usage: SessionUsage;
  model: string;
}

/**
 * Phase 3: tournament selected a winner. The winning candidate is the one
 * whose response is then applied / verified in the standard pipeline.
 */
export interface TournamentWinnerSelectedEntry extends LedgerEntryHeader {
  type: 'tournament-winner-selected';
  obligationIndex: number;
  roundIndex: number;
  candidateIndex: number;
  personaId: string;
  responseSha256: string;
  score: number;
  rationale: string;
}

/**
 * Phase 3: tournament exhausted its round cap without producing a winner
 * that satisfies the obligation. The run escalates: §6 specifies surfacing
 * to the user with all candidate diffs and verifier scores.
 */
export interface TournamentEscalatedEntry extends LedgerEntryHeader {
  type: 'tournament-escalated';
  obligationIndex: number;
  obligationType: string;
  roundsRun: number;
  /** Highest candidate score seen across all rounds. */
  bestScore: number;
  detail: string;
}

/** Discriminated union of every ledger entry shape. */
export type LedgerEntry =
  | RunStartedEntry
  | ObligationAttemptedEntry
  | CandidateRecordedEntry
  | ObligationSatisfiedEntry
  | ObligationFailedEntry
  | RunFinishedEntry
  | TournamentRoundStartedEntry
  | CandidateDiscardedEntry
  | TournamentWinnerSelectedEntry
  | TournamentEscalatedEntry
  | RunResumedEntry
  | ObligationMemoizedEntry;

/** Type tag union for all ledger entries. */
export type LedgerEntryType = LedgerEntry['type'];
