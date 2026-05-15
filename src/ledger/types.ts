// Append-only evidence ledger type definitions. The hash chain in
// ledger.ts canonicalizes each entry minus `entryHash`, so the on-disk
// JSON bytes are determined by the *runtime* field order callers
// produce — these types only constrain shape, not serialization order.

import type { SessionUsage } from '../session/types';

// Optional on entries written by session calls; absent for non-call
// entries (e.g. run-started). Pre-provider-architecture entries also
// parse without these fields.
export interface ProviderAttribution {
  provider?: 'deterministic' | 'local' | 'anthropic' | 'stub';
  modelId?: string | null;
  backend?: string | null;
  grammar?: string | null;
  seed?: number | null;
  source?: string | null;
  usageEstimated?: boolean;
}

// Genesis prevHash is the all-zero digest; entryHash is sha256 hex of
// the canonical JSON of this entry with `entryHash` itself excluded.
export interface LedgerEntryHeader {
  ts: string;
  runId: string;
  seq: number;
  prevHash: string;
  entryHash: string;
}

// Per-kind payload shape. Adding a new kind = add a row here. Entries
// produced by session calls intersect with ProviderAttribution.
export interface LedgerEntryPayloadMap {
  'run-started': {
    contractId: string;
    contractHash: string;
    obligationCount: number;
    goal: string;
  };
  'obligation-attempted': {
    obligationIndex: number;
    obligationType: string;
    personaId: string;
  };
  'candidate-recorded': {
    obligationIndex: number;
    personaId: string;
    responseSha256: string;
    usage: SessionUsage;
    model: string;
  } & ProviderAttribution;
  'obligation-satisfied': {
    obligationIndex: number;
    obligationType: string;
    detail: string;
  };
  'obligation-failed': {
    obligationIndex: number;
    obligationType: string;
    detail: string;
  };
  'run-finished': {
    satisfied: number;
    failed: number;
    totalUsage: SessionUsage;
  };
  'run-resumed': {
    contractId: string;
    contractHash: string;
    // Identical to runId when in-place.
    resumeOf: string;
    alreadySatisfied: number;
    pending: number;
  };
  'obligation-memoized': {
    obligationIndex: number;
    obligationType: string;
    obligationKey: string;
    source: 'prior-run' | 'prior-winner';
    responseSha256: string | null;
    detail: string;
  };
  'tournament-round-started': {
    obligationIndex: number;
    obligationType: string;
    roundIndex: number;
    roundCap: number;
    personaIds: string[];
    temperatures: number[];
  };
  'candidate-discarded': {
    obligationIndex: number;
    roundIndex: number;
    candidateIndex: number;
    personaId: string;
    responseSha256: string;
    score: number;
    rationale: string;
    usage: SessionUsage;
    model: string;
  } & ProviderAttribution;
  'tournament-winner-selected': {
    obligationIndex: number;
    roundIndex: number;
    candidateIndex: number;
    personaId: string;
    responseSha256: string;
    score: number;
    rationale: string;
  };
  'tournament-escalated': {
    obligationIndex: number;
    obligationType: string;
    roundsRun: number;
    bestScore: number;
    detail: string;
  };
  'obligation-deterministic-attempted': {
    obligationIndex: number;
    obligationType: string;
    strategyName: string;
  };
  'obligation-deterministic-applied': {
    obligationIndex: number;
    obligationType: string;
    strategyName: string;
    filesAffected: string[];
    wallTimeMs: number;
    detail: string;
  };
  'obligation-deterministic-failed': {
    obligationIndex: number;
    obligationType: string;
    strategyName: string;
    // `error`: thrown / sandbox failures.
    // `verifier-rejected`: strategy applied but verifier still failed.
    // `not-applied`: strategy declined to write anything.
    reason: 'error' | 'verifier-rejected' | 'not-applied';
    detail: string;
  };
  'candidate-stream-aborted': {
    obligationIndex: number;
    // Round index when emitted from a tournament; 0 for single mode.
    roundIndex: number;
    candidateIndex: number;
    personaId: string;
    partialResponseSha256: string;
    abortedAtChars: number;
    reason: string;
    usageAtAbort: SessionUsage;
    model: string;
  } & ProviderAttribution;
  'obligation-pre-verified': {
    obligationIndex: number;
    obligationType: string;
    detail: string;
  };
  'post-merge-verified': {
    passed: boolean;
    obligationCount: number;
    failedCount: number;
    outcomes: ReadonlyArray<{
      obligationIndex: number;
      obligationType: string;
      passed: boolean;
      detail: string;
    }>;
    detail: string;
  };
  'falsification-call': {
    obligationIndex: number;
    obligationType: string;
    adapterName: string;
    // From FalsificationResult: counter-example-input |
    // regression-fixture | property-violation-trace |
    // no-falsification-found.
    resultKind: string;
    counterExamplesFound: number;
    wallClockMs: number;
    dollarsBilled: number;
    dollarsApiEquivalent: number;
    detail: string;
  };
  'falsifier-dispatch-decision': {
    obligationIndex: number;
    obligationType: string;
    // 'sequential' or 'ucb1'.
    kind: string;
    order: string[];
    // `null` score when UCB1 priority was +Infinity (untried adapter).
    scores: Array<{ adapter: string; score: number | null }>;
  };
  // Pre-apply bytes live in a sidecar under
  // .swarm/snapshots/<runId>/<obligationIndex>/<preBlobSha>; this entry
  // carries only SHAs. Blob SHAs use the `git hash-object` algorithm
  // (header `blob <byteLength>\0` + content, SHA1).
  'workspace-snapshot': {
    obligationIndex: number;
    files: ReadonlyArray<{
      path: string;
      preBlobSha: string | 'absent';
      expectedPostBlobSha: string | 'absent';
    }>;
  };
  // Modeled on ARIES Compensation Log Records (Mohan et al. 1992):
  // restoredFiles carries enough state that a crash mid-rollback can
  // be resumed by inspecting the ledger.
  'obligation-rolled-back': {
    obligationIndex: number;
    trigger:
      | 'per-obligation-falsification'
      | 'per-obligation-failed-apply'
      | 'post-merge-regression';
    success: boolean;
    restoredFiles: ReadonlyArray<{
      path: string;
      restoredBlobSha: string | 'absent';
    }>;
    detail: string;
  };
}

export type LedgerEntryType = keyof LedgerEntryPayloadMap;

// Generic entry: header + discriminator + payload, indexed by kind.
// The mapped-type-then-index trick makes `LedgerEntry` distribute over
// the kind union, so it's a discriminated union the way callers expect.
export type LedgerEntry<K extends LedgerEntryType = LedgerEntryType> = {
  [Tag in LedgerEntryType]: LedgerEntryHeader & { type: Tag } & LedgerEntryPayloadMap[Tag];
}[K];

// Back-compat aliases. Every entry shape that pre-existed this refactor
// exports under the same name.
export type RunStartedEntry = LedgerEntry<'run-started'>;
export type ObligationAttemptedEntry = LedgerEntry<'obligation-attempted'>;
export type CandidateRecordedEntry = LedgerEntry<'candidate-recorded'>;
export type ObligationSatisfiedEntry = LedgerEntry<'obligation-satisfied'>;
export type ObligationFailedEntry = LedgerEntry<'obligation-failed'>;
export type RunFinishedEntry = LedgerEntry<'run-finished'>;
export type RunResumedEntry = LedgerEntry<'run-resumed'>;
export type ObligationMemoizedEntry = LedgerEntry<'obligation-memoized'>;
export type TournamentRoundStartedEntry = LedgerEntry<'tournament-round-started'>;
export type CandidateDiscardedEntry = LedgerEntry<'candidate-discarded'>;
export type TournamentWinnerSelectedEntry = LedgerEntry<'tournament-winner-selected'>;
export type TournamentEscalatedEntry = LedgerEntry<'tournament-escalated'>;
export type ObligationDeterministicAttemptedEntry = LedgerEntry<'obligation-deterministic-attempted'>;
export type ObligationDeterministicAppliedEntry = LedgerEntry<'obligation-deterministic-applied'>;
export type ObligationDeterministicFailedEntry = LedgerEntry<'obligation-deterministic-failed'>;
export type CandidateStreamAbortedEntry = LedgerEntry<'candidate-stream-aborted'>;
export type ObligationPreVerifiedEntry = LedgerEntry<'obligation-pre-verified'>;
export type PostMergeVerifiedEntry = LedgerEntry<'post-merge-verified'>;
export type FalsificationCallEntry = LedgerEntry<'falsification-call'>;
export type FalsifierDispatchDecisionEntry = LedgerEntry<'falsifier-dispatch-decision'>;
export type WorkspaceSnapshotEntry = LedgerEntry<'workspace-snapshot'>;
export type ObligationRolledBackEntry = LedgerEntry<'obligation-rolled-back'>;
