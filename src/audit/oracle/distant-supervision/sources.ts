// Distant-supervision source interpreters. Each function turns the parsed
// records of one anchor source into triage instances, deciding the label and
// tier per Phase 0's gate. The functions are pure (no filesystem): the mining
// script reads bytes and hashes diffs, these decide what the bytes mean.
//
// Placement: near the oracle, which owns ground truth. The oracle is the
// strong positive source; the restoration proofs are real-data positives; the
// revert anchor is a weak positive (Phase 0 rejected it as primary); the clean
// corpus is the unlabeled negative pool.

import type { TriageInstance } from '../../triage/types';

/** A parsed oracle `.label.json` plus the resolved diff location. */
export interface OracleLabelInput {
  readonly category: string;
  readonly injectorId: string;
  readonly sourcePrUrl: string;
  /** Diff filename stem, e.g. `cursor-foo-bar-pr3`. Unique within a category. */
  readonly prStem: string;
  readonly diffPath: string;
  readonly sha256: string;
}

/** A parsed execution-grounded restoration/tamper proof record. */
export interface RestorationProofInput {
  /** e.g. `mui/material-ui#45596`. */
  readonly prRef: string;
  readonly verdict: string;
  readonly category: string;
  readonly sourcePrUrl: string;
  readonly diffPath: string;
  readonly sha256: string;
}

/** A real PR from the revert/hotfix or the presumed-clean corpus. */
export interface RealPrInput {
  readonly repo: string;
  readonly prNumber: number;
  readonly sourcePrUrl: string;
  readonly diffPath: string;
  readonly sha256: string;
}

/** Filesystem-safe slug for a `owner/repo` string. */
function slug(repo: string): string {
  return repo.replace(/[^A-Za-z0-9._-]+/g, '-');
}

/** Oracle injections are ground-truth positives, one per label. */
export function oracleInstances(labels: readonly OracleLabelInput[]): TriageInstance[] {
  return labels.map((l) => ({
    id: `oracle-injected:${l.category}/${l.prStem}`,
    label: 'positive',
    tier: 'oracle-injected',
    category: l.category,
    sourcePrUrl: l.sourcePrUrl,
    diffPath: l.diffPath,
    sha256: l.sha256,
  }));
}

/** A restoration proof is a real-data positive only when the proof verdict
 *  actually proves the tamper. Everything else (not-proven, runner-unsupported)
 *  is dropped, not counted as a positive: an unproven proof is not a label. */
export function isProvenRestoration(verdict: string): boolean {
  return verdict.startsWith('proven');
}

export function restorationInstances(proofs: readonly RestorationProofInput[]): TriageInstance[] {
  return proofs
    .filter((p) => isProvenRestoration(p.verdict))
    .map((p) => {
      // prRef is `owner/repo#number`; keep the `#` so the id matches the
      // revert/clean convention (`slug(repo)#number`).
      const [repo, num] = p.prRef.split('#');
      return {
        id: `restoration-proof:${slug(repo)}#${num}`,
        label: 'positive' as const,
        tier: 'restoration-proof' as const,
        category: p.category,
        sourcePrUrl: p.sourcePrUrl,
        diffPath: p.diffPath,
        sha256: p.sha256,
      };
    });
}

/** Revert-bad PRs are weak positives. Phase 0 measured the revert label does
 *  not correlate with cheating in aggregate, so they enter the dataset as a
 *  down-weighted source the label model can discount, never as ground truth. */
export function revertInstances(prs: readonly RealPrInput[]): TriageInstance[] {
  return prs.map((p) => ({
    id: `revert-weak:${slug(p.repo)}#${p.prNumber}`,
    label: 'positive' as const,
    tier: 'revert-weak' as const,
    category: null,
    sourcePrUrl: p.sourcePrUrl,
    diffPath: p.diffPath,
    sha256: p.sha256,
  }));
}

/** Presumed-clean merged PRs are the unlabeled negative pool under PU. */
export function cleanInstances(prs: readonly RealPrInput[]): TriageInstance[] {
  return prs.map((p) => ({
    id: `clean-presumed:${slug(p.repo)}#${p.prNumber}`,
    label: 'unlabeled' as const,
    tier: 'clean-presumed' as const,
    category: null,
    sourcePrUrl: p.sourcePrUrl,
    diffPath: p.diffPath,
    sha256: p.sha256,
  }));
}
