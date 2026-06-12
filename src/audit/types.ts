// Public surface shared by every audit submodule. `Finding` is the
// audit primitive — one entry per cheat the detector caught. `pass` on
// the aggregate AuditResult is `false` whenever any finding has severity
// 'block'; the PR-comment renderer and the GitHub Action exit code key
// off the same boolean.

export type CheatCategory =
  | 'test-relaxation'
  | 'mock-of-hallucination'
  | 'assertion-strip'
  | 'no-op-fix'
  | 'coverage-erosion'
  | 'fake-refactor'
  | 'comment-only-fix'
  | 'error-swallow'
  | 'exception-rethrow-lost-context'
  | 'dead-branch-insertion'
  | 'type-suppression'
  // Semantic categories. No structural detector keys on these: the diff
  // looks legitimate and only a judge reading the PR's claim against the
  // code can call the cheat. They are produced by the judge-primary path,
  // never by a deterministic detector.
  | 'goal-not-fixed'
  | 'cheat-mock-mutation'
  // Execution-grounded categories. These are not cheats and have no
  // structural or judge tell; they are produced by running the change
  // (mutation testing, issue-linked repro, coverage) in a sandboxed
  // checkout. They ship advisory and are measured against the real-PR
  // corpus, not the injection oracle (there is no injector for them).
  | 'mutation-survives-on-changed-line'
  | 'mutation-survives-on-uncovered-changed-line'
  | 'issue-repro-still-fails'
  | 'pr-breaks-issue-repro'
  | 'uncovered-changed-line';

/** The two judge-primary-only categories, separated for the call sites
 *  that must not hand a semantic category to a structural detector. */
export type SemanticCheatCategory = 'goal-not-fixed' | 'cheat-mock-mutation';

export const SEMANTIC_CHEAT_CATEGORIES: readonly SemanticCheatCategory[] = [
  'goal-not-fixed',
  'cheat-mock-mutation',
];

/** Categories produced only by the execution-grounded layer. Separated so a
 *  caller can route them (advisory severity, dedicated ledger kinds) without
 *  string-matching, and so they are never confused with a cheat detector. */
export type ExecutionGroundedCategory =
  | 'mutation-survives-on-changed-line'
  | 'mutation-survives-on-uncovered-changed-line'
  | 'issue-repro-still-fails'
  | 'pr-breaks-issue-repro'
  | 'uncovered-changed-line';

export const EXECUTION_GROUNDED_CATEGORIES: readonly ExecutionGroundedCategory[] = [
  'mutation-survives-on-changed-line',
  'mutation-survives-on-uncovered-changed-line',
  'issue-repro-still-fails',
  'pr-breaks-issue-repro',
  'uncovered-changed-line',
];

export function isExecutionGroundedCategory(category: string): category is ExecutionGroundedCategory {
  return (EXECUTION_GROUNDED_CATEGORIES as readonly string[]).includes(category);
}

export type Severity = 'block' | 'warn' | 'info';

/**
 * A finding's confidence grade, ordered weakest to strongest. The single value
 * both precision gates write through their shared setter:
 *   - `structural-only`: a deterministic detector hit with no further backing.
 *   - `judge-confirmed`: the LLM judge confirmed the finding (confirm-findings).
 *   - `runtime-corroborated`: an execution-grounded signal backs it (corroborate).
 */
export type FindingConfidence = 'structural-only' | 'judge-confirmed' | 'runtime-corroborated';

export interface FindingLocation {
  file: string;
  line: number;
  endLine?: number;
}

export interface Finding {
  category: CheatCategory;
  severity: Severity;
  message: string;
  location: FindingLocation;
  evidence: string;
  /**
   * True when the PR-intent layer escalated this finding's severity
   * above what the detector originally emitted. The renderer uses
   * this to print a one-line note at the top of the PR comment
   * quoting the agent's fix-claim. Absent (undefined) means the
   * layer did not fire on this finding, either because the PR did
   * not claim a fix, the policy was `off`, or the starting severity
   * was already terminal.
   */
  intentUpgraded?: boolean;
  /**
   * v10.3: when the LLM judge contributed to this finding firing, the
   * model's one-sentence reasoning is preserved here for the renderer
   * to show under the finding. Absent on deterministic-only findings.
   */
  judgeReasoning?: string;
  /**
   * v10.3: pinned model id the judge ran against (e.g.
   * `claude-haiku-4-5-20251001`). Required so replay over the same
   * diff and title produces the recorded answer.
   */
  judgeModelId?: string;
  /**
   * v11.1: short hash of the judge's prompt inputs (title and diff shas),
   * surfaced in the PR comment next to the model id so a reader can tie the
   * rendered verdict back to the exact input recorded in the ledger.
   */
  judgePromptHash?: string;
  /**
   * v10.4: the judge confirmation gate set this to `true` when the
   * judge confirmed the finding is a real cheat. Findings the judge
   * refuted are downgraded to advisory and do not carry this flag.
   */
  judgeConfirmed?: boolean;
  /**
   * v11.1: the single graded confidence both precision gates write
   * through. Ordered weakest to strongest (structural-only <
   * judge-confirmed < runtime-corroborated); the shared setter only ever
   * raises it, so the judge gate (confirm-findings) and the runtime
   * corroborator (corroborate), which run at different points, cannot
   * disagree or clobber each other. Surfaced in the PR comment next to
   * the measured-precision badge.
   */
  confidence?: FindingConfidence;
  /**
   * v11: set by the judge-primary path on a finding the judge raised on
   * its own, with no deterministic candidate behind it (the semantic
   * categories). The ledger writer records these as
   * `pr-audit-judge-primary` rather than `pr-audit-finding`.
   */
  judgePrimary?: boolean;
  /**
   * v11.1: set by the opt-in runtime corroboration step when an
   * execution-grounded signal (a surviving mutant, a coverage gap, or a
   * still-failing issue repro) on the same file within this finding's
   * changed-line range backs the structural finding. Absent on findings
   * with no runtime backing, which stay advisory unchanged. See
   * `execution-grounded/corroborate.ts`.
   */
  runtimeCorroboration?: RuntimeCorroboration;
}

/** Evidence that an execution-grounded signal corroborates a structural
 *  finding. Exactly one signal kind is recorded, with its underlying data: the
 *  mutant ids that survived, the uncovered changed lines, the issue repro
 *  reference that still fails, or the restored-test identities that fail. */
export interface RuntimeCorroboration {
  signal:
    | 'surviving-mutant'
    | 'coverage-gap'
    | 'repro-still-fails'
    | 'restored-test-fails'
    | 'type-error-surfaces'
    | 'dangling-reference'
    | 'dead-branch-unreached';
  /** Surviving-mutant ids, e.g. `BlockStatement@src/x.ts:12 -> Survived`. */
  mutants?: string[];
  /** Changed lines no test executed. */
  uncoveredLines?: number[];
  /** Issue reference whose repro still fails, e.g. `owner/repo#123`. */
  repro?: string;
  /** Failing-test identities from a proven test restoration, e.g.
   *  `calc › adds two numbers`. */
  failingTests?: string[];
  /** tsc diagnostics a proven type-suppression restoration surfaced once the
   *  added directive was reverted (signal `type-error-surfaces`). */
  diagnostics?: string[];
  /** `file:line` references to a renamed-away symbol that a proven fake-refactor
   *  restoration found surviving in the head checkout (signal
   *  `dangling-reference`). */
  references?: string[];
  /** Repo tests that reached the inserted branch's condition but never its body
   *  in a proven dead-branch restoration (signal `dead-branch-unreached`). */
  reachedByTests?: string[];
}

export interface AuditAgentAttribution {
  vendor: string;
  version?: string;
  confidence: 'high' | 'medium' | 'low';
  source: string;
}

/**
 * Selects which subset of the cheat-detector registry to load.
 *
 *   - `default`: the four advisory-grade detectors targeted for v2.0
 *     work in v10.2 (error-swallow, mock-of-hallucination, no-op-fix,
 *     fake-refactor).
 *   - `experimental`: default plus the six retired detectors that did
 *     not earn their context on the v10.1 real-corpus baseline.
 *   - `all`: alias for `experimental`. Preserved for callers that
 *     pinned the v10.1 flat-registry name.
 */
export type DetectorSetName = 'default' | 'experimental' | 'all';

/**
 * Suspicion-score mode. `advise` (the default) reports findings but
 * never exits non-zero from a blocking finding; `gate` preserves the
 * v10.1 merge-blocking exit-code contract. The mode is recorded on
 * the AuditResult and on the rendered PR comment so a downstream
 * reader can tell which behavior produced the verdict.
 */
export type AuditMode = 'advise' | 'gate';

export interface AuditInput {
  unifiedDiff: string;
  repoRoot: string;
  agent?: AuditAgentAttribution;
  detectorSet?: DetectorSetName;
  /**
   * v10.3: when true, detectors that integrate an LLM judge (currently
   * `no-op-fix`) call out to Anthropic Haiku via the gated path. Off by
   * default to preserve the no-credentials default contract of `swarm
   * audit`. Toggled from CLI via `--enable-llm-judge` or the
   * `SWARM_AUDIT_LLM_JUDGE=1` env var.
   */
  judgeEnabled?: boolean;
  /**
   * v10.3: ledger handle for judge invocations to record into. When
   * absent the judge still runs (cache + answer), but no
   * `llm-judge-result` entries are written. Threaded by the audit CLI
   * so the audit ledger is the one source of judge replay state.
   */
  judgeLedger?: JudgeLedgerSink;
  pr?: {
    number: number;
    headSha: string;
    baseSha: string;
    title: string;
    body: string;
    author: string;
    headRef: string;
    repository: string;
  };
}

/**
 * Minimal ledger sink the judge needs. A callback wrapped around
 * whatever ledger the caller owns; the audit CLI passes a closure
 * over `HashChainedLedger.append`. Decoupled so the audit surface
 * does not have to depend on `src/ledger/` types directly.
 */
export interface JudgeLedgerEntry {
  type: 'llm-judge-result';
  detector: string;
  modelId: string;
  cacheHit: boolean;
  diffSha: string;
  titleSha: string;
  answer: 'yes' | 'no' | 'unavailable';
  reason?: string;
}

export interface JudgeLedgerSink {
  appendJudgeEntry(entry: JudgeLedgerEntry): void;
}

export interface AuditResult {
  pass: boolean;
  findings: Finding[];
  agent?: AuditAgentAttribution;
  pr?: AuditInput['pr'];
  generatedAt: string;
  detectorVersions: Record<string, string>;
  /**
   * Which detector set was loaded for this run. Recorded so the
   * rendered comment, AIBOM, and ledger entries are interpretable
   * after the fact when an audit is replayed with a different set.
   */
  detectorSet?: DetectorSetName;
}
