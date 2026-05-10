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

/**
 * Phase 5: a deterministic strategy was dispatched against an
 * obligation. Always emitted before either an
 * `obligation-deterministic-applied` or
 * `obligation-deterministic-failed` entry.
 */
export interface ObligationDeterministicAttemptedEntry extends LedgerEntryHeader {
  type: 'obligation-deterministic-attempted';
  obligationIndex: number;
  obligationType: string;
  strategyName: string;
}

/**
 * Phase 5: a deterministic strategy applied successfully and the
 * verifier confirmed the obligation. Zero LLM tokens were consumed.
 * Counted via `runResult.deterministicObligations` and used by the
 * §8 cost benchmark.
 */
export interface ObligationDeterministicAppliedEntry extends LedgerEntryHeader {
  type: 'obligation-deterministic-applied';
  obligationIndex: number;
  obligationType: string;
  strategyName: string;
  /** Repo-relative paths the strategy wrote or modified. */
  filesAffected: string[];
  /** Wall time spent in the strategy, ms. */
  wallTimeMs: number;
  /** Free-form note for the audit trail. */
  detail: string;
}

/**
 * Phase 5: a deterministic strategy ran and the obligation is being
 * rerouted to synthesis. Logged whether the strategy errored, the
 * verifier rejected its output, or the strategy declined to apply.
 * The §8 misclassification recovery path: "no retry of the WASM
 * module" — synthesis takes over from here.
 */
export interface ObligationDeterministicFailedEntry extends LedgerEntryHeader {
  type: 'obligation-deterministic-failed';
  obligationIndex: number;
  obligationType: string;
  strategyName: string;
  /**
   * Why the strategy failed. `error` for thrown / sandbox failures;
   * `verifier-rejected` when the strategy applied but the verifier
   * still failed; `not-applied` when the strategy declined to write
   * anything.
   */
  reason: 'error' | 'verifier-rejected' | 'not-applied';
  detail: string;
}

/**
 * Phase 6: a candidate generation was aborted mid-stream because the
 * streaming verifier detected a contract violation that could not be
 * repaired by continuing. The aborted-at offset is the character offset
 * within the partial response where the early-abort signal fired; tokens
 * generated up to that point are still billed (`usageAtAbort`), but the
 * remaining generation cost was avoided. See impl guide §9 ("Token
 * savings on aborted generations measurable in run output").
 */
export interface CandidateStreamAbortedEntry extends LedgerEntryHeader {
  type: 'candidate-stream-aborted';
  obligationIndex: number;
  /** Round index when emitted from a tournament; 0 for single mode. */
  roundIndex: number;
  candidateIndex: number;
  personaId: string;
  /** Sha256 of the partial response observed before abort. */
  partialResponseSha256: string;
  /** Character offset in the partial response where the abort fired. */
  abortedAtChars: number;
  /** Free-form reason; matches the streaming verifier's violation rationale. */
  reason: string;
  /** Token usage observed up to the abort point. */
  usageAtAbort: SessionUsage;
  model: string;
}

/**
 * Phase 6: an obligation was skipped by pre-generation verification —
 * no synthesis attempt, no deterministic dispatch. Distinct from
 * `obligation-memoized` (Phase 4) because pre-generation skipping
 * checks the live workspace (the file already exists, the build/test
 * already passes) rather than a prior ledger state. Together with
 * memoization this formalizes impl guide §9 "Pre-generation
 * verification: skip obligations already satisfied".
 */
export interface ObligationPreVerifiedEntry extends LedgerEntryHeader {
  type: 'obligation-pre-verified';
  obligationIndex: number;
  obligationType: string;
  /** Free-form note describing how the live workspace already satisfies it. */
  detail: string;
}

/**
 * Phase 6: a post-merge integration check ran across every committed
 * obligation. Emitted exactly once per run, after the population loop
 * finishes and before `run-finished`. `passed` reflects the aggregate
 * outcome; per-obligation results live in `outcomes`. Catches the
 * "two obligations that individually pass but together produce a broken
 * build" class (impl guide §9).
 */
export interface PostMergeVerifiedEntry extends LedgerEntryHeader {
  type: 'post-merge-verified';
  /** True when every obligation re-passed end-to-end. */
  passed: boolean;
  /** Number of obligations re-checked. */
  obligationCount: number;
  /** Number of obligations whose post-merge re-check failed. */
  failedCount: number;
  /** Per-obligation outcomes; index parallels the contract list. */
  outcomes: ReadonlyArray<{
    obligationIndex: number;
    obligationType: string;
    passed: boolean;
    detail: string;
  }>;
  /** Free-form summary detail. */
  detail: string;
}

/**
 * Falsification adapter call. One entry per dispatched adapter call,
 * appended after the producer's verification of an obligation succeeds.
 * Carries enough cost data and the result kind so audits can reconstruct
 * adapter yield without a separate cost-attribution file.
 */
export interface FalsificationCallEntry extends LedgerEntryHeader {
  type: 'falsification-call';
  obligationIndex: number;
  obligationType: string;
  adapterName: string;
  /** Discriminator from FalsificationResult: counter-example-input | regression-fixture | property-violation-trace | no-falsification-found */
  resultKind: string;
  /**
   * Number of confirmed counter-examples found. Zero for non-falsifying
   * results; >0 means the producer's patch was falsified.
   */
  counterExamplesFound: number;
  /** Wall clock for the single adapter call. */
  wallClockMs: number;
  /** Real dollars billed to the operator's account. */
  dollarsBilled: number;
  /** API-equivalent dollar value (cross-adapter comparison surface). */
  dollarsApiEquivalent: number;
  /** Free-form summary detail. */
  detail: string;
}

/**
 * Workspace mutation snapshot recorded immediately before a producer's
 * patch is applied. Used by `rollbackObligation` to restore the workspace
 * when a falsifier later finds a counter-example or the post-merge
 * integration check detects a regression.
 *
 * Pre-apply file bytes are written to a sidecar directory under
 * `.swarm/snapshots/<runId>/<obligationIndex>/<preBlobSha>`; this entry
 * carries only SHAs, not bytes, to keep the JSONL small.
 *
 * Content-only: blob SHAs use the same algorithm as `git hash-object`
 * (header `blob <byteLength>\0` + content, SHA1). File modes, symlinks,
 * and binary-special-case handling are out of scope; persona-emitted
 * diffs in this codebase do not touch them in practice.
 *
 * Replay/resume treats this entry as informational. Resume drives off
 * `obligation-satisfied` and `obligation-failed`; snapshot entries are
 * audit trail only.
 */
export interface WorkspaceSnapshotEntry extends LedgerEntryHeader {
  type: 'workspace-snapshot';
  obligationIndex: number;
  files: ReadonlyArray<{
    path: string;
    /** Pre-apply blob SHA, or 'absent' if the file did not exist. */
    preBlobSha: string | 'absent';
    /**
     * Expected blob SHA after the producer's patch is applied. Used by
     * rollback to detect cases where the file was mutated by something
     * other than the obligation's apply (later obligation, concurrent
     * process, manual edit) between apply and rollback.
     */
    expectedPostBlobSha: string | 'absent';
  }>;
}

/**
 * Recorded by `rollbackObligation` after the workspace files for an
 * obligation are restored. Modeled on ARIES Compensation Log Records
 * (Mohan et al. 1992, ACM TODS 17(1)): the entry carries enough state
 * that a crash mid-rollback can be resumed by a future run inspecting
 * the ledger to identify which files have already been restored.
 *
 * `restoredFiles` is empty when `success` is false (state-mismatch or
 * io-error returned before any file was touched).
 *
 * Replay/resume treats this entry as informational; the next run sees
 * the workspace as it actually is on disk.
 */
export interface ObligationRolledBackEntry extends LedgerEntryHeader {
  type: 'obligation-rolled-back';
  obligationIndex: number;
  trigger: 'per-obligation-falsification' | 'post-merge-regression';
  success: boolean;
  restoredFiles: ReadonlyArray<{
    path: string;
    /**
     * Blob SHA of the file content after rollback completed, or
     * 'absent' if rollback unlinked the file (pre-apply state was
     * 'absent'). This is the ARIES recovery-invariant evidence: caller
     * verified `restoredBlobSha === preBlobSha` before writing this
     * entry. A crash-safe resume can compare on-disk SHAs against this
     * field to determine which restores already completed.
     */
    restoredBlobSha: string | 'absent';
  }>;
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
  | ObligationMemoizedEntry
  | ObligationDeterministicAttemptedEntry
  | ObligationDeterministicAppliedEntry
  | ObligationDeterministicFailedEntry
  | CandidateStreamAbortedEntry
  | ObligationPreVerifiedEntry
  | PostMergeVerifiedEntry
  | FalsificationCallEntry
  | WorkspaceSnapshotEntry
  | ObligationRolledBackEntry;

/** Type tag union for all ledger entries. */
export type LedgerEntryType = LedgerEntry['type'];
