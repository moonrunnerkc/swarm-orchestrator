// Shared types for the real-PR validation harness. The harness fetches
// real merged PRs from public repos, audits each with the v10 pipeline,
// and classifies the findings with an independent LLM arbiter. Every
// stage reads and writes one of the JSON shapes defined here so the
// pipeline is reproducible from the committed artifacts.

/** The four-way arbiter classification of a single audit finding. */
export type ArbiterVerdict = 'true-cheat' | 'false-alarm' | 'debatable' | 'insufficient-context';

/** Which path inside the audit raised a finding. Structural detectors are
 *  deterministic; judge-confirm is a structural candidate the judge
 *  confirmed; judge-primary is a finding the judge raised on its own. */
export type JudgePath = 'structural' | 'judge-primary' | 'judge-confirm';

/** One merged PR selected for the corpus. Carries enough metadata to
 *  re-fetch the exact diff (headSha) and to render the report. */
export interface SourcePr {
  repo: string;
  prNumber: number;
  headSha: string;
  title: string;
  bodyExcerpt: string;
  url: string;
  mergedAt: string;
  additions: number;
  deletions: number;
  files: number;
  /** Relative path of the vendored raw diff under benchmarks/real-prs/. */
  diffPath: string;
}

/** The committed record of what was fetched, so the corpus is auditable
 *  and reproducible: the query, the date, and a head SHA per PR. */
export interface SourcesFile {
  fetchedAt: string;
  query: string;
  perRepoCap: number;
  repos: string[];
  /** Repos that were requested but yielded no qualifying PRs, with why. */
  skippedRepos: Array<{ repo: string; reason: string }>;
  prs: SourcePr[];
}

/** A finding normalized out of the audit pipeline's `Finding` shape into
 *  the fields the arbiter and the report need. */
export interface HarnessFinding {
  /** Stable key for cross-referencing across stages: repo#pr:category:file:hunk. */
  key: string;
  repo: string;
  prNumber: number;
  category: string;
  severity: 'block' | 'warn' | 'info';
  subjectPath: string;
  hunkIndex: number | null;
  lineRange: { start: number; end: number } | null;
  judgePath: JudgePath;
  message: string;
  evidence: string;
  judgeRationale: string | null;
}

/** Per-PR audit output: the pre-upgrade and post-upgrade finding lists. */
export interface AuditResultRecord {
  repo: string;
  prNumber: number;
  headSha: string;
  /** Findings from the frozen pre-upgrade pipeline. Null when the
   *  pre-upgrade build was unavailable (recorded honestly, never faked). */
  pre: HarnessFinding[] | null;
  post: HarnessFinding[];
}

/** One arbiter classification, keyed to a HarnessFinding.key. */
export interface ArbiterLabel {
  key: string;
  repo: string;
  prNumber: number;
  category: string;
  judgePath: JudgePath;
  verdict: ArbiterVerdict;
  /** Arbiter's self-reported confidence in [0, 1]. */
  confidence: number;
  arbiterModel: string;
}

/** The arbiter's reasoning paragraph per call, so labels are auditable. */
export interface ArbiterRationale {
  key: string;
  repo: string;
  prNumber: number;
  verdict: ArbiterVerdict;
  confidence: number;
  reasoning: string;
  arbiterModel: string;
}

/** Output of the arbiter sanity gate: agreement with stamped oracle
 *  labels on a held-out slice. The real-PR run is blocked when
 *  `agreement` is below the threshold. */
export interface ArbiterSanity {
  ranAt: string;
  arbiterModel: string;
  sliceSize: number;
  agreed: number;
  agreement: number;
  threshold: number;
  passed: boolean;
  perCategory: Array<{ category: string; total: number; agreed: number }>;
}

// --- Regression corpus (the retrospectively-bad PRs) ----------------------

/** Which retrospective signal proves a merged PR was wrong, and the link
 *  that backs it. Every labeled-bad PR carries at least one. */
export type RegressionProofKind = 'revert' | 'fix-pr' | 'hotfix' | 'issue';

export interface RegressionProof {
  kind: RegressionProofKind;
  /** The PR/commit/issue that proves the labeled PR was wrong. */
  url: string;
  /** SHA of the revert/hotfix commit, or of the proving PR's merge, when known. */
  sha: string | null;
  /** The exact text in the proving artifact's body/title that names the bad PR. */
  mentionedInBody: string;
}

/** A cheat-relevant stratification bucket inferred from the bad PR's diff. */
export type RegressionCategory =
  | 'test-changed-no-code-fix'
  | 'code-change-missed-bug'
  | 'error-swallowed'
  | 'covered-behavior-regressed'
  | 'other';

/** One merged PR that later proved wrong, with the proof attached. */
export interface RegressionPr {
  repo: string;
  prNumber: number;
  headSha: string;
  title: string;
  bodyExcerpt: string;
  url: string;
  mergedAt: string;
  additions: number;
  deletions: number;
  files: number;
  /** Relative path of the vendored raw diff under benchmarks/regression-corpus/. */
  diffPath: string;
  /** Strongest retrospective category inferred from the diff. */
  category: RegressionCategory;
  /** Every proof that this PR was wrong (>= 1). */
  proofs: RegressionProof[];
}

export interface RegressionSourcesFile {
  fetchedAt: string;
  windowMonths: number;
  repos: string[];
  /** Repos that yielded fewer than the per-repo floor, with why. */
  shortRepos: Array<{ repo: string; found: number; reason: string }>;
  prs: RegressionPr[];
}

// --- Differential against off-the-shelf analyzers -------------------------

/** One finding from an external static analyzer, normalized so it can be
 *  intersected with the auditor's findings by (file, line, category). */
export interface DifferentialFinding {
  tool: string;
  ruleId: string;
  severity: string;
  file: string;
  line: number;
  message: string;
}

/** Per-PR differential record: the auditor's post-upgrade findings and
 *  every external tool's findings on the same PR diff. */
export interface DifferentialRecord {
  repo: string;
  prNumber: number;
  corpus: 'regression' | 'clean';
  tools: string[];
  externalFindings: DifferentialFinding[];
}

/** One row of the Venn analysis for a single PR. */
export interface VennPr {
  repo: string;
  prNumber: number;
  corpus: 'regression' | 'clean';
  onlyAuditor: number;
  onlyExternal: number;
  both: number;
  /** Auditor finding keys with no external finding at the same file+line+category. */
  onlyAuditorKeys: string[];
}

export interface VennSummary {
  generatedAt: string;
  tools: string[];
  perCorpus: Array<{
    corpus: 'regression' | 'clean';
    onlyAuditor: number;
    onlyExternal: number;
    both: number;
  }>;
  prs: VennPr[];
}

// --- Dual-arbiter agreement -----------------------------------------------

/** A finding labeled by both arbiters, with the agreement decision. A
 *  finding is high-confidence only when both arbiters return the same
 *  verdict; otherwise it is `arbiter-split` and excluded from the
 *  headline counts. */
export interface DualArbiterLabel {
  key: string;
  repo: string;
  prNumber: number;
  category: string;
  judgePath: JudgePath;
  primary: { model: string; verdict: ArbiterVerdict; confidence: number };
  secondary: { model: string; verdict: ArbiterVerdict; confidence: number };
  agreed: boolean;
  /** The agreed verdict when `agreed`, else null. */
  verdict: ArbiterVerdict | null;
}
