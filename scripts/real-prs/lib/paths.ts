// Canonical on-disk locations for every real-PR harness artifact. One
// place so the stages agree on where to read and write.

import * as path from 'path';

export function repoRoot(): string {
  // dist/scripts/real-prs/lib -> repo root is four levels up at runtime.
  return path.resolve(__dirname, '..', '..', '..', '..');
}

export function realPrsDir(root = repoRoot()): string {
  return path.join(root, 'benchmarks', 'real-prs');
}

export function sourcesFile(root = repoRoot()): string {
  return path.join(realPrsDir(root), 'sources.json');
}

export function diffsDir(root = repoRoot()): string {
  return path.join(realPrsDir(root), 'diffs');
}

export function auditResultsDir(root = repoRoot()): string {
  return path.join(realPrsDir(root), 'audit-results');
}

export function arbiterLabelsFile(root = repoRoot()): string {
  return path.join(realPrsDir(root), 'arbiter-labels.json');
}

export function arbiterRationaleFile(root = repoRoot()): string {
  return path.join(realPrsDir(root), 'arbiter-rationale.json');
}

export function arbiterSanityFile(root = repoRoot()): string {
  return path.join(realPrsDir(root), 'arbiter-sanity.md');
}

export function handReviewQueueFile(root = repoRoot()): string {
  return path.join(realPrsDir(root), 'hand-review-queue.md');
}

export function reportFile(root = repoRoot()): string {
  return path.join(realPrsDir(root), 'REAL-WORLD-REPORT.md');
}

export function costFile(root = repoRoot()): string {
  return path.join(realPrsDir(root), 'cost.json');
}

/** A filesystem-safe slug for a `owner/repo` string. */
export function repoSlug(repo: string): string {
  return repo.replace(/[^A-Za-z0-9._-]+/g, '-');
}

// --- v2 clean corpus (scaled to 10 repos) ---------------------------------

export function sourcesV2File(root = repoRoot()): string {
  return path.join(realPrsDir(root), 'sources-v2.json');
}

export function auditResultsV2Dir(root = repoRoot()): string {
  return path.join(realPrsDir(root), 'audit-results-v2');
}

export function repoSelectionFile(root = repoRoot()): string {
  return path.join(realPrsDir(root), 'repo-selection.md');
}

export function costLedgerFile(root = repoRoot()): string {
  return path.join(realPrsDir(root), 'cost-ledger.json');
}

export function benefitReportFile(root = repoRoot()): string {
  return path.join(realPrsDir(root), 'v11-BENEFIT-REPORT.md');
}

export function redundancyFindingFile(root = repoRoot()): string {
  return path.join(realPrsDir(root), 'REDUNDANCY-FINDING.md');
}

export function dualArbiterLabelsFile(root = repoRoot()): string {
  return path.join(realPrsDir(root), 'arbiter-labels-dual.json');
}

// --- Agent corpus (PRs the fingerprinter attributes to an AI agent) -------

export function agentCorpusDir(root = repoRoot()): string {
  return path.join(realPrsDir(root), 'agent-corpus');
}

export function agentSourcesFile(root = repoRoot()): string {
  return path.join(agentCorpusDir(root), 'sources.json');
}

export function agentDiffsDir(root = repoRoot()): string {
  return path.join(agentCorpusDir(root), 'diffs');
}

export function agentAuditResultsDir(root = repoRoot()): string {
  return path.join(agentCorpusDir(root), 'audit-results');
}

export function agentLabelsFile(root = repoRoot()): string {
  return path.join(agentCorpusDir(root), 'arbiter-labels-dual.json');
}

export function agentIncidenceReportFile(root = repoRoot()): string {
  return path.join(agentCorpusDir(root), 'INCIDENCE-REPORT.md');
}

// --- Regression corpus (retrospectively-bad PRs) --------------------------

export function regressionDir(root = repoRoot()): string {
  return path.join(root, 'benchmarks', 'regression-corpus');
}

export function regressionSourcesFile(root = repoRoot()): string {
  return path.join(regressionDir(root), 'sources.json');
}

export function regressionDiffsDir(root = repoRoot()): string {
  return path.join(regressionDir(root), 'diffs');
}

export function regressionCoverageFile(root = repoRoot()): string {
  return path.join(regressionDir(root), 'coverage.md');
}

export function regressionAuditResultsDir(root = repoRoot()): string {
  return path.join(regressionDir(root), 'audit-results');
}

export function differentialDir(root = repoRoot()): string {
  return path.join(regressionDir(root), 'differential');
}

export function vennJsonFile(root = repoRoot()): string {
  return path.join(regressionDir(root), 'venn.json');
}

export function vennMdFile(root = repoRoot()): string {
  return path.join(regressionDir(root), 'venn.md');
}
