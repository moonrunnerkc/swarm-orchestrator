// Revert/hotfix proof: the label-free ground truth for the block gate. A merged
// PR that was later reverted, fixed by a follow-up PR, or hotfixed is one that
// actually went wrong in production. The regression corpus records each bad
// PR's proof (the revert/fix-PR diff) in its sources.json; this module is the
// single place that reads that proof, shared by two callers:
//
//   1. The offline correlation harness (scripts/real-prs/
//      correlate-execution-grounded.ts) fetches each proof diff and matches
//      findings to the lines the revert/hotfix later changed.
//   2. The block-trigger calibrator scores each trigger's precision against
//      whether the PRs it fired on were reverted or hotfixed.
//
// The network fetch stays out of this module so it has no dependency on the
// scripts layer: callers fetch the proof diffs and pass them in.

import { extractChangedLineRanges, type ChangedLineRanges } from '../cheat-detector/diff-walker';

/** How a later artifact proved a merged PR was bad. `issue` is the weakest:
 *  an issue pointing at the PR is not proof the change was undone. */
export type ProofKind = 'revert' | 'fix-pr' | 'hotfix' | 'issue';

/** A proving artifact that a merged PR was bad. Mirrors the regression corpus
 *  sources.json shape; `sha` and `mentionedInBody` are present there but only
 *  `kind` and `url` are needed here. */
export interface Proof {
  kind: string;
  url: string;
  sha?: string | null;
  mentionedInBody?: string;
}

/** A GitHub pull or commit reference parsed out of a proof URL. */
export interface ProofRef {
  owner: string;
  repo: string;
  /** Pull number or commit sha, as it appeared in the URL. */
  ref: string;
}

const PROOF_URL_RE = /github\.com\/([\w.-]+)\/([\w.-]+)\/(?:pull|commit)\/(\w+)/;

/**
 * Parse the owner, repo, and pull/commit ref out of a proof URL, or null when
 * the URL is not a recognizable GitHub pull/commit link.
 *
 * @param url a proof URL, e.g. `https://github.com/acme/widgets/pull/42`
 * @returns the parsed reference, or null
 */
export function parseProofUrl(url: string): ProofRef | null {
  const m = PROOF_URL_RE.exec(url);
  if (m === null || m[1] === undefined || m[2] === undefined || m[3] === undefined) return null;
  return { owner: m[1], repo: m[2], ref: m[3] };
}

// A revert, a follow-up fix-PR, or a hotfix is hard proof the change was undone
// or patched. An issue alone is not: it may be open, wrong, or never acted on.
const HARD_PROOF_KINDS: ReadonlySet<string> = new Set(['revert', 'fix-pr', 'hotfix']);

/**
 * Whether a PR's proofs show it was reverted or hotfixed: the label-free fact
 * the block gate calibrates against. True when at least one proof is a revert,
 * fix-PR, or hotfix; an issue-only proof does not count.
 *
 * @param proofs the PR's recorded proving artifacts
 * @returns true when the PR was reverted, fix-PR'd, or hotfixed
 */
export function wasRevertedOrHotfixed(proofs: readonly Proof[]): boolean {
  return proofs.some((p) => HARD_PROOF_KINDS.has(p.kind));
}

/**
 * Merge the changed-line ranges a set of already-fetched proof diffs touch,
 * optionally restricted to a set of files (the audited PR's files, so a proof
 * that changed unrelated files does not inflate the match). The network fetch
 * is the caller's; this only parses diffs.
 *
 * @param diffs the proof diffs as unified-diff text
 * @param auditedFiles when set, keep only ranges in these files
 * @returns merged per-file changed-line ranges across the proof diffs
 */
export function proofChangedRanges(
  diffs: Iterable<string>,
  auditedFiles?: ReadonlySet<string>,
): ChangedLineRanges {
  const merged: ChangedLineRanges = {};
  for (const diff of diffs) {
    const ranges = extractChangedLineRanges(diff);
    for (const [file, rs] of Object.entries(ranges)) {
      if (auditedFiles !== undefined && !auditedFiles.has(file)) continue;
      (merged[file] ??= []).push(...rs);
    }
  }
  return merged;
}
