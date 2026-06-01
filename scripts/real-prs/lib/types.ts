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
