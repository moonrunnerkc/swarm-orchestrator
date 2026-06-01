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
