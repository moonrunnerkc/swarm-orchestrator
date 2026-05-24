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
  | 'dead-branch-insertion';

export type Severity = 'block' | 'warn' | 'info';

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
