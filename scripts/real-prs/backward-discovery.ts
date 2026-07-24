// Discovery sources for the backward miner. The June nightly funnel showed the
// diagnosis plainly: 758 candidates processed, 740 dropped at attribution, 0
// agent-attributed. The revert net catches reverts fine; almost none of the
// reverted commits are agent commits. So discovery widens along two axes:
// more outcome markers (hotfix commits and issue-linked regression fixes that
// blame a sha), and one source that starts from agent-authored merges directly
// (where attribution cannot fail) and lets the untouched findOutcomeEvidence
// bar decide whether a short-interval follow-up fix landed on them.
//
// Every source is labeled on its candidates and in the funnel record, so yield
// per source is measurable from the nightly artifact. Discovery only proposes;
// the confirmation bar (attributeAndConfirm -> findOutcomeEvidence) is shared
// and unchanged, so a widened net cannot weaken what counts as outcome-bad.

import { revertedShasInMessage } from './lib/github';
import { THIN_REVIEW_QUERIES, EXCLUDED_OWNERS, isDependencyBot } from './fetch-agent-prs';

/** Where a backward candidate came from. Labeled so yield per source is
 *  measurable; `revert-marker` is the pre-widening source. */
export type DiscoverySource =
  | 'revert-marker'
  | 'hotfix-marker'
  | 'issue-linked-regression'
  | 'followup-fix';

/** One (repo, blamed-sha) candidate a discovery source derived. */
export interface BackwardCandidate {
  repo: string;
  /** The commit the marker blames (the potentially bad agent change). */
  revertedSha: string;
  /** The artifact that surfaced it: a marker commit sha, or a PR URL. */
  surfacedBy: string;
  source: DiscoverySource;
}

/** A commit search result item, the shape all commit-search extractors read. */
export interface CommitSearchItem {
  sha: string;
  commit: { message: string };
  repository?: { full_name?: string } | null;
}

function repoOf(item: CommitSearchItem): string | null {
  const repo = item.repository?.full_name;
  return repo === undefined || repo === null ? null : repo;
}

// Phrases that blame a specific commit for the breakage, with the sha inline
// (optionally as a full commit URL). The hex-run floor of 7 keeps ordinary
// words and short numbers out; a rare non-sha hit just 404s at the commit
// fetch and lands in the drop distribution.
const BLAMED_SHA_PATTERNS: RegExp[] = [
  /\b(?:introduced|caused|regressed|broken|broke)\s+(?:in|by)\s+(?:commit\s+)?(?:https?:\/\/github\.com\/\S+\/commit\/)?([0-9a-f]{7,40})\b/gi,
  /\bregression\s+(?:from|of|in)\s+(?:commit\s+)?(?:https?:\/\/github\.com\/\S+\/commit\/)?([0-9a-f]{7,40})\b/gi,
];

/**
 * Extract every commit sha a message blames for a breakage ("caused by <sha>",
 * "regression from <sha>", commit-URL forms included). Lower-cased, deduped.
 * Distinct from `revertedShasInMessage`: that matches the trailer git itself
 * writes; this matches the human blame phrasing hotfix and regression-fix
 * commits carry.
 *
 * @param message a commit message.
 * @returns the blamed shas, lower-cased and deduped.
 */
export function blamedShasInMessage(message: string): string[] {
  const out = new Set<string>();
  for (const re of BLAMED_SHA_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(message)) !== null) {
      if (m[1] !== undefined) out.add(m[1].toLowerCase());
    }
  }
  return [...out];
}

/**
 * Pure: the candidates a revert-marker search item yields, one per sha the
 * message's `This reverts commit` trailers name.
 *
 * @param item a commit search result.
 * @returns the labeled candidates (empty when the item has no repository).
 */
export function revertCandidatesFromItem(item: CommitSearchItem): BackwardCandidate[] {
  const repo = repoOf(item);
  if (repo === null) return [];
  return revertedShasInMessage(item.commit.message).map((revertedSha) => ({
    repo,
    revertedSha,
    surfacedBy: item.sha,
    source: 'revert-marker' as const,
  }));
}

const HOTFIX_MARKER = /\bhotfix\b/i;

/**
 * Pure: the candidates a hotfix-marker search item yields. A hotfix commit is
 * a candidate source only when its message blames a specific sha; a hotfix
 * that names nothing gives the backward walk no commit to check, so it counts
 * as a marker found but derives no candidate (that gap is itself measured).
 *
 * @param item a commit search result.
 * @returns the labeled candidates.
 */
export function hotfixCandidatesFromItem(item: CommitSearchItem): BackwardCandidate[] {
  const repo = repoOf(item);
  if (repo === null || !HOTFIX_MARKER.test(item.commit.message)) return [];
  return blamedShasInMessage(item.commit.message).map((revertedSha) => ({
    repo,
    revertedSha,
    surfacedBy: item.sha,
    source: 'hotfix-marker' as const,
  }));
}

const ISSUE_LINK = /(?:^|[^&\w])#\d+\b|github\.com\/\S+\/issues\/\d+/;
const FIX_INTENT = /\b(?:fix(?:es|ed)?|resolv(?:es|ed)|close[sd]?)\b/i;

/**
 * Pure: the candidates an issue-linked regression-fix search item yields. The
 * message must link an issue, carry fix intent, and blame a sha; whether the
 * blamed commit is agent-authored and whether the fix really re-touched its
 * lines is decided downstream by the unchanged attribution and
 * findOutcomeEvidence stages.
 *
 * @param item a commit search result.
 * @returns the labeled candidates.
 */
export function regressionFixCandidatesFromItem(item: CommitSearchItem): BackwardCandidate[] {
  const repo = repoOf(item);
  if (repo === null) return [];
  const message = item.commit.message;
  if (!ISSUE_LINK.test(message) || !FIX_INTENT.test(message)) return [];
  return blamedShasInMessage(message).map((revertedSha) => ({
    repo,
    revertedSha,
    surfacedBy: item.sha,
    source: 'issue-linked-regression' as const,
  }));
}

/** The PR fields the followup-fix source needs to derive a candidate. */
export interface FollowupPrDetail {
  repo: string;
  number: number;
  url: string;
  mergedAt: string | null;
  /** The sha that landed on the default branch (the squash/merge commit). */
  mergeCommitSha: string | null;
  headSha: string;
  authorLogin: string;
  mergedByLogin: string | null;
  reviewCommentCount: number;
}

/**
 * Pure: derive a followup-fix candidate from a thin-review search hit's PR
 * detail, or the reason it is rejected. Applies amendment 3's local
 * confirmation (zero review comments, author-merged; `review:none` is already
 * server-side) plus the same owner and dependency-bot exclusions the two-arm
 * fetcher uses. The candidate sha is the merge commit when GitHub reports one,
 * so a squash-merge's follow-up window is scanned on the sha that actually
 * landed.
 *
 * @param detail the PR detail fields.
 * @returns the candidate, or the drop reason for the funnel.
 */
export function followupCandidateFromDetail(
  detail: FollowupPrDetail,
): { candidate: BackwardCandidate } | { dropReason: string } {
  if (detail.mergedAt === null) return { dropReason: 'not-merged' };
  const owner = detail.repo.split('/')[0] ?? '';
  if (EXCLUDED_OWNERS.has(owner.toLowerCase())) return { dropReason: 'excluded-owner' };
  if (isDependencyBot(detail.authorLogin)) return { dropReason: 'dependency-bot' };
  if (detail.reviewCommentCount !== 0) return { dropReason: 'not-thin-review' };
  if (
    detail.mergedByLogin === null ||
    detail.authorLogin.length === 0 ||
    detail.mergedByLogin.toLowerCase() !== detail.authorLogin.toLowerCase()
  ) {
    return { dropReason: 'not-thin-review' };
  }
  const sha = detail.mergeCommitSha ?? detail.headSha;
  if (sha.length === 0) return { dropReason: 'no-landed-sha' };
  return {
    candidate: {
      repo: detail.repo,
      revertedSha: sha.toLowerCase(),
      surfacedBy: detail.url,
      source: 'followup-fix',
    },
  };
}

/** A commit-search discovery source: one query, one pure extractor. */
export interface CommitSearchSourcePlan {
  kind: 'commit-search';
  source: Exclude<DiscoverySource, 'followup-fix'>;
  query: string;
  extract: (item: CommitSearchItem) => BackwardCandidate[];
}

/** The PR-search discovery source: agent merges in thin-review water. */
export interface PrSearchSourcePlan {
  kind: 'pr-search';
  source: 'followup-fix';
  queries: string[];
  aim: string;
}

export type DiscoverySourcePlan = CommitSearchSourcePlan | PrSearchSourcePlan;

/** Where the followup-fix source is aimed, recorded verbatim in the artifact. */
export const FOLLOWUP_AIM =
  'thin-review population per benchmarks/real-prs/capability-hunt/PREREGISTRATION-AMENDMENT-3.md';

/**
 * Cumulative-share budget split across the sources, in run order. Without a
 * split the revert source (866 candidates per nightly run) consumes the whole
 * budget and the widened sources never execute; with it, a source that stops
 * at its share records `source-budget` and the remainder rolls forward, so an
 * underspending source donates its slack to the next.
 */
export const SOURCE_BUDGET_SHARES: Record<DiscoverySource, number> = {
  'revert-marker': 0.4,
  'hotfix-marker': 0.15,
  'issue-linked-regression': 0.15,
  'followup-fix': 0.3,
};

/**
 * Build the ordered discovery plan for one run. The revert source runs first
 * and its query is byte-identical to the pre-widening miner, so the continuity
 * source's behavior under budget is unchanged up to its share.
 *
 * @param since ISO date lower bound for markers and merges.
 * @returns the ordered source plans.
 */
export function buildDiscoveryPlan(since: string): DiscoverySourcePlan[] {
  return [
    {
      kind: 'commit-search',
      source: 'revert-marker',
      query: `"This reverts commit" committer-date:>=${since}`,
      extract: revertCandidatesFromItem,
    },
    {
      kind: 'commit-search',
      source: 'hotfix-marker',
      query: `hotfix committer-date:>=${since}`,
      extract: hotfixCandidatesFromItem,
    },
    {
      kind: 'commit-search',
      source: 'issue-linked-regression',
      query: `regression committer-date:>=${since}`,
      extract: regressionFixCandidatesFromItem,
    },
    {
      kind: 'pr-search',
      source: 'followup-fix',
      queries: THIN_REVIEW_QUERIES.map(({ q }) => `${q} merged:>=${since}`),
      aim: FOLLOWUP_AIM,
    },
  ];
}
