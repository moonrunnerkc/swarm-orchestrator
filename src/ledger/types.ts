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

// Optional per-entry agent attribution (v10). When an entry is produced
// in response to work an AI coding agent did (e.g. an audit of a PR
// opened by Cursor), the attribution flows into the canonical-JSON
// hash chain just like any other field. Absent on entries that did not
// originate from a recognizable agent — pre-v10 ledger files parse
// without surfacing this field at all.
export interface LedgerAgentAttribution {
  vendor: string;
  version?: string;
  confidence?: 'high' | 'medium' | 'low';
  source?: string;
}

// Genesis prevHash is the all-zero digest; entryHash is sha256 hex of
// the canonical JSON of this entry with `entryHash` itself excluded.
export interface LedgerEntryHeader {
  ts: string;
  runId: string;
  seq: number;
  prevHash: string;
  entryHash: string;
  aiAgent?: LedgerAgentAttribution;
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
  // v10 audit entries.
  'pr-audit-started': {
    prNumber: number | null;
    prRepository: string | null;
    prHeadSha: string;
    prBaseSha: string;
    detectorsScheduled: string[];
  };
  'pr-audit-finding': {
    category: string;
    severity: 'block' | 'warn' | 'info';
    file: string;
    line: number;
    endLine?: number;
    message: string;
    evidenceSha256: string;
  };
  'pr-audit-completed': {
    prNumber: number | null;
    prRepository: string | null;
    pass: boolean;
    findingCount: number;
    blockingCount: number;
    warningCount: number;
    detectorVersions: Record<string, string>;
    wallTimeMs: number;
    detail: string;
  };
  // v10.3 LLM-judge invocation record. One entry per judge call (cache
  // hit or live). Pinned `modelId` makes replay deterministic: rerunning
  // an audit against the same (diffSha, titleSha, modelId) tuple must
  // produce the recorded answer.
  'llm-judge-result': {
    detector: string;
    modelId: string;
    cacheHit: boolean;
    diffSha: string;
    titleSha: string;
    answer: 'yes' | 'no' | 'unavailable';
    reason?: string;
  };
  // v11 judge-primary finding. Distinct from `pr-audit-finding` so a
  // semantic finding the judge raised on its own (no deterministic
  // candidate behind it) is distinguishable in the ledger from a
  // detector finding the judge merely confirmed.
  'pr-audit-judge-primary': {
    category: string;
    modelId: string;
    answer: 'yes' | 'no' | 'unavailable';
    file: string;
    line: number;
    reason?: string;
  };
  // v11.1 execution-grounded findings. Distinct kinds so a finding that
  // came from running the change (mutation, repro, coverage) is
  // distinguishable in the ledger from a structural or judge finding.
  // `evidencePath` points at the stored raw artifact (Stryker JSON, repro
  // stdout/stderr, coverage JSON) that backs the finding.
  'pr-audit-mutation-finding': {
    category: string;
    severity: 'block' | 'warn' | 'info';
    file: string;
    line: number;
    mutator: string;
    status: string;
    evidencePath?: string;
  };
  'pr-audit-issue-repro-finding': {
    category: string;
    severity: 'block' | 'warn' | 'info';
    issueRef: string;
    verdict: string;
    evidencePath?: string;
  };
  'pr-audit-coverage-finding': {
    category: string;
    severity: 'block' | 'warn' | 'info';
    file: string;
    line: number;
    evidencePath?: string;
  };
  // Test-restoration proof record: one entry per qualifying structural
  // finding the restoration phase evaluated, every verdict included, so the
  // ledger carries the full proof funnel and not just the proven tail.
  // `controls` mirrors the proof record's three internal controls; null means
  // that control never executed. `reproduceCommand` is the exact command a
  // human runs in a fresh checkout to replay a proven verdict (empty
  // otherwise).
  'pr-audit-restoration': {
    category: string;
    verdict: string;
    findingFile: string;
    testFiles: string[];
    failingTests: string[];
    controls: {
      baseTestPasses: boolean | null;
      tamperedSuitePasses: boolean | null;
      restoredFailsTwiceSameIdentity: boolean | null;
    };
    reproduceCommand: string;
  };
  // Mock-mutation restoration proof record: one entry per qualifying
  // `cheat-mock-mutation` finding the restoration phase evaluated, every
  // verdict included. `controls` mirrors the proof's three internal controls;
  // null means that control never executed. `mockedReturnValues` are the
  // expressions the added mocks inject (for the comment).
  'pr-audit-mock-restoration': {
    category: string;
    verdict: string;
    findingFile: string;
    testFiles: string[];
    failingTests: string[];
    mockedReturnValues: string[];
    controls: {
      tamperedSuitePasses: boolean | null;
      restoredFailsTwiceSameIdentity: boolean | null;
      mockReturnsAssertedValue: boolean | null;
    };
    reproduceCommand: string;
  };
  // No-op-fix restoration proof record. PR-level (the proof is gated by a fix
  // claim, not a structural finding), so a run carries at most one. `controls`
  // mirrors the proof's three internal controls; null means that control never
  // executed.
  'pr-audit-no-op-fix-restoration': {
    category: string;
    verdict: string;
    findingFile: string;
    revertedSourceFiles: string[];
    affectedTestFiles: string[];
    prClaim: string;
    controls: {
      prClaimsFix: boolean | null;
      suitePassesAsSubmitted: boolean | null;
      revertedSuiteStillPassesTwice: boolean | null;
    };
    reproduceCommand: string;
  };
  // Type-suppression restoration proof record: one entry per qualifying
  // `type-suppression` finding the restoration phase evaluated, every verdict
  // included. `controls` mirrors the proof's three internal controls; null
  // means that control never executed. `surfacedDiagnostics` are the tsc
  // diagnostics that appeared once the directive was reverted (the proof).
  'pr-audit-type-suppression-restoration': {
    category: string;
    verdict: string;
    findingFile: string;
    removedDirectives: string[];
    surfacedDiagnostics: string[];
    controls: {
      directiveRemoved: boolean | null;
      fileCleanAsSubmitted: boolean | null;
      diagnosticSurfacesWhenRemoved: boolean | null;
    };
    reproduceCommand: string;
  };
  // Fake-refactor restoration proof record: one entry per qualifying
  // `fake-refactor` finding the restoration phase evaluated, every verdict
  // included. `controls` mirrors the proof's three internal controls; null
  // means that check never ran. `references` are the `file:line` locations
  // where the renamed-away symbol still appears in the head checkout.
  'pr-audit-fake-refactor-restoration': {
    category: string;
    verdict: string;
    findingFile: string;
    oldName: string;
    newName: string;
    references: string[];
    controls: {
      oldSymbolResolved: boolean | null;
      oldSymbolDeclarationRemoved: boolean | null;
      oldSymbolStillReferenced: boolean | null;
    };
    reproduceCommand: string;
  };
  // Dead-branch restoration proof record: one entry per qualifying
  // `dead-branch-insertion` finding the restoration phase evaluated, every
  // verdict included. `controls` mirrors the proof's three internal controls;
  // null means that check never ran. `affectedTestFiles` are the repo tests
  // whose closure reaches the branch file (what was run instrumented).
  'pr-audit-dead-branch-restoration': {
    category: string;
    verdict: string;
    findingFile: string;
    branchCondition: string;
    branchLine: number;
    affectedTestFiles: string[];
    controls: {
      branchResolved: boolean | null;
      suitePassesAsSubmitted: boolean | null;
      branchNeverExecuted: boolean | null;
    };
    reproduceCommand: string;
  };
  // A verifiable-evidence block-trigger candidate: a self-certifying
  // runtime fact (a falsified issue repro, a structural finding a surviving
  // mutant or coverage gap corroborates on the same line, a failed declared
  // obligation, or a fully-controlled test-restoration proof). `eligible`
  // records whether the trigger is allowed to gate per the revert-calibrated
  // block-eligibility policy; `blocked` records whether it actually failed the
  // merge on this run. Both are false until the calibration promotes the
  // trigger. `evidenceSha256` pins the canonical evidence so the rendered
  // verdict ties back to a replayable fact, and `reproduce` is the exact
  // command that regenerates it.
  'pr-audit-block-trigger': {
    trigger:
      | 'claim-falsified'
      | 'corroborated-under-constraint'
      | 'obligation-failure'
      | 'test-tamper-proven'
      | 'mock-mutation-proven'
      | 'no-op-fix-proven'
      | 'type-suppression-proven'
      | 'fake-refactor-proven'
      | 'dead-branch-proven';
    eligible: boolean;
    blocked: boolean;
    summary: string;
    reproduce: string;
    evidenceSha256: string;
    category?: string;
    file?: string;
    line?: number;
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
export type PrAuditStartedEntry = LedgerEntry<'pr-audit-started'>;
export type PrAuditFindingEntry = LedgerEntry<'pr-audit-finding'>;
export type PrAuditCompletedEntry = LedgerEntry<'pr-audit-completed'>;
export type LlmJudgeResultEntry = LedgerEntry<'llm-judge-result'>;
export type PrAuditJudgePrimaryEntry = LedgerEntry<'pr-audit-judge-primary'>;
export type PrAuditMutationFindingEntry = LedgerEntry<'pr-audit-mutation-finding'>;
export type PrAuditIssueReproFindingEntry = LedgerEntry<'pr-audit-issue-repro-finding'>;
export type PrAuditCoverageFindingEntry = LedgerEntry<'pr-audit-coverage-finding'>;
export type PrAuditRestorationEntry = LedgerEntry<'pr-audit-restoration'>;
export type PrAuditMockRestorationEntry = LedgerEntry<'pr-audit-mock-restoration'>;
export type PrAuditNoOpFixRestorationEntry = LedgerEntry<'pr-audit-no-op-fix-restoration'>;
export type PrAuditTypeSuppressionRestorationEntry =
  LedgerEntry<'pr-audit-type-suppression-restoration'>;
export type PrAuditFakeRefactorRestorationEntry =
  LedgerEntry<'pr-audit-fake-refactor-restoration'>;
export type PrAuditDeadBranchRestorationEntry =
  LedgerEntry<'pr-audit-dead-branch-restoration'>;
export type PrAuditBlockTriggerEntry = LedgerEntry<'pr-audit-block-trigger'>;
