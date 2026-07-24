// Backward mining of outcome-confirmed-bad agent commits.
//
// The forward miner (mine-confirmed-bad.ts) starts from a sample of agent PRs
// and asks "was this later reverted or hotfixed?". It only ever sees the agent
// PRs it happened to fetch. This miner runs the other direction: it starts from
// the BAD OUTCOMES already visible in the wild, walks back to the commit they
// blame, and keeps the ones an agent authored. Discovery runs four labeled
// sources (see backward-discovery.ts): revert markers (the original net),
// hotfix markers that blame a sha, issue-linked regression fixes that blame a
// sha, and agent-authored thin-review merges checked for short-interval
// follow-up fixes. Yield per source is recorded in the funnel so the nightly
// artifact says which net catches and which does not.
//
// Reuse, not fork: the revert/hotfix confirmation is the exact
// `findOutcomeEvidence` the corpus labeler and the forward miner use, so every
// mined entry carries the same canonical evidence SHAs. Agent attribution is the
// same `detectAgent` fingerprinter the audit surface uses. Discovery widening
// touches neither: a wider net proposes more candidates, the unchanged bar
// disposes of them.
//
// Bounded by construction: a hard GitHub API-call budget and a wall-clock cap,
// both parameters, so a nightly cron cannot run away. The budget is split
// across the sources by cumulative shares (SOURCE_BUDGET_SHARES) so the first
// source cannot starve the rest; a run that hits a cap records how far it got
// and stops; it never pads.
//
// Usage:
//   node dist/scripts/real-prs/mine-backward.js \
//     [--api-budget 300] [--wall-clock-ms 1800000] [--limit 50] [--months 18]
//
// Output (merged, deduped by reverted sha):
//   benchmarks/real-prs/agent-corpus/confirmed-bad-backward.json

import * as fs from 'fs';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { detectAgent } from '../../src/audit/pr-source';
import { makeOctokit, parseRepo, resolveGithubToken } from './lib/github';
import { extractChangedLineRanges } from '../../src/audit/cheat-detector/diff-walker';
import {
  buildDiscoveryPlan,
  followupCandidateFromDetail,
  revertCandidatesFromItem,
  SOURCE_BUDGET_SHARES,
  type BackwardCandidate,
  type CommitSearchItem,
  type DiscoverySource,
  type DiscoverySourcePlan,
} from './backward-discovery';
import {
  defaultBranchOf,
  findOutcomeEvidence,
  type OctokitLike,
  type OutcomeEvidence,
} from '../labeling/outcome-labels';

// Re-exported so callers and tests keep one import path for the miner surface.
export { revertCandidatesFromItem };

const log = getLogger('real-prs:mine-backward');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a GitHub call through GitHub's *secondary* rate limit, honoring
 * Retry-After. The secondary limit is burst-triggered and separate from the
 * primary hourly quota (it never shows in the rate_limit counters), so without
 * this a bounded backward mine stalls on a 403 without ever returning, blowing
 * past the wall-clock cap (which is only checked between candidates, never
 * during an in-flight request). Primary-quota exhaustion is the caller's budget
 * concern and is not retried here.
 */
async function withRetry<T>(fn: () => Promise<T>, label: string, attempt = 0): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const status = (err as { status?: number }).status;
    const headers = (err as { response?: { headers?: Record<string, string> } }).response?.headers;
    const retryAfter = Number(headers?.['retry-after']);
    if ((status === 403 || status === 429) && attempt < 5) {
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2_000 * 2 ** attempt;
      log.warn(`${label} hit a secondary rate limit; waiting ${waitMs}ms (attempt ${attempt + 1})`);
      await sleep(waitMs);
      return withRetry(fn, label, attempt + 1);
    }
    throw err;
  }
}

const OUT_FILE = path.join('benchmarks', 'real-prs', 'agent-corpus', 'confirmed-bad-backward.json');
const HOTFIX_WINDOW_DAYS = 30;

/** The GitHub surface this miner needs, beyond the labeler's OctokitLike. */
export interface BackwardOctokit extends OctokitLike {
  repos: OctokitLike['repos'] & {
    listPullRequestsAssociatedWithCommit(p: {
      owner: string;
      repo: string;
      commit_sha: string;
    }): Promise<{
      data: Array<{
        number: number;
        title: string;
        body: string | null;
        head: { ref: string };
        user: { login: string } | null;
        merged_at?: string | null;
      }>;
    }>;
  };
  pulls: {
    get(p: { owner: string; repo: string; pull_number: number }): Promise<{
      data: {
        number: number;
        merged_at: string | null;
        merge_commit_sha: string | null;
        head: { sha: string };
        user: { login: string } | null;
        merged_by: { login: string } | null;
        review_comments: number;
      };
    }>;
  };
  search: OctokitLike['search'] & {
    issuesAndPullRequests(p: { q: string; per_page: number; page: number }): Promise<{
      data: {
        items: Array<{
          number: number;
          title: string;
          html_url: string;
          user?: { login?: string } | null;
        }>;
      };
    }>;
  };
}

export interface BackwardBudget {
  /** Hard cap on GitHub API calls this run may make. */
  apiBudget: number;
  /** Wall-clock cap (ms). The run stops cleanly when it is reached. */
  wallClockMs: number;
  /** Max confirmed entries to mine (stop early once reached). */
  limit: number;
  /** Only consider markers on or after this many months ago. */
  months: number;
  /** Injectable clock for tests; defaults to Date.now. */
  now?: () => number;
}

export interface BackwardEntry {
  /** owner/repo of the reverted commit. */
  repo: string;
  /** The agent-authored commit that was reverted/hotfixed (the bad change). */
  revertedSha: string;
  /** The PR that introduced it, when resolvable. */
  prNumber: number | null;
  /** The detected agent vendor. */
  vendor: string;
  outcome: 'reverted' | 'hotfixed';
  /** Canonical evidence SHAs from findOutcomeEvidence (the same the labeler emits). */
  evidence: OutcomeEvidence[];
  /** The marker commit or PR that surfaced this entry in the backward scan. */
  surfacedBy: string;
  /** The discovery source that surfaced it. Absent on pre-widening corpus
   *  entries, which were all revert-marker discovered. */
  source?: DiscoverySource;
}

/** Per-source yield accounting: markers found, candidates derived, entries
 *  confirmed, and the rejection-reason distribution, so the artifact says
 *  which net catches. Additive to the flat funnel; old readers ignore it. */
export interface SourceFunnel {
  /** Search items this source returned (markers found). */
  markers: number;
  /** Candidates this source derived from those markers. */
  candidates: number;
  /** Candidates confirmed outcome-bad (the final entries). */
  confirmed: number;
  /** Why this source's candidates (and pre-candidate hits) dropped. */
  dropReasons: Record<string, number>;
  /** Set when the source stopped before exhausting its input
   *  ('source-budget' when it hit its budget share). */
  stopped?: string;
}

/**
 * Staged funnel counts for one mine run, so a zero yield is diagnosable at a
 * glance: the stage where the count collapses is the diagnosis (the world or the
 * instrument). The flat stage counters total across every discovery source
 * (their names predate the multi-source widening and are kept for reader
 * compatibility); `bySource` splits markers, candidates, confirmations, and
 * drop reasons per source.
 */
export interface BackwardFunnel {
  /** Discovery search items returned, all sources. */
  revertMarkers: number;
  /** (repo, blamed-sha) candidates derived, all sources. */
  revertCandidates: number;
  /** Candidates that reached attribution (post-dedup, pre-budget-stop). */
  candidatesProcessed: number;
  /** Candidates whose associated-PR lookup returned (call succeeded). */
  prLookupResolved: number;
  /** Candidates whose blamed commit was fetchable (identifiable commit). */
  commitResolved: number;
  /** Candidates that carried an identifiable author (PR user or commit author). */
  identifiableAuthor: number;
  /** Candidates the shipped fingerprinter attributed to an agent. */
  agentAttributed: number;
  /** Candidates that reached the findOutcomeEvidence confirmation stage. */
  evidenceChecked: number;
  /** Candidates confirmed outcome-bad (reverted | hotfixed): the final entries. */
  evidenceConfirmed: number;
  /** Why candidates dropped, keyed by stage, all sources. */
  dropReasons: Record<string, number>;
  /** Per-discovery-source split of markers / candidates / confirmations / drops. */
  bySource: Record<string, SourceFunnel>;
}

function emptyFunnel(): BackwardFunnel {
  return {
    revertMarkers: 0,
    revertCandidates: 0,
    candidatesProcessed: 0,
    prLookupResolved: 0,
    commitResolved: 0,
    identifiableAuthor: 0,
    agentAttributed: 0,
    evidenceChecked: 0,
    evidenceConfirmed: 0,
    dropReasons: {},
    bySource: {},
  };
}

function sourceFunnel(funnel: BackwardFunnel, source: DiscoverySource): SourceFunnel {
  const existing = funnel.bySource[source];
  if (existing !== undefined) return existing;
  const fresh: SourceFunnel = { markers: 0, candidates: 0, confirmed: 0, dropReasons: {} };
  funnel.bySource[source] = fresh;
  return fresh;
}

function drop(funnel: BackwardFunnel | undefined, reason: string, source?: DiscoverySource): void {
  if (funnel === undefined) return;
  funnel.dropReasons[reason] = (funnel.dropReasons[reason] ?? 0) + 1;
  if (source !== undefined) {
    const sf = sourceFunnel(funnel, source);
    sf.dropReasons[reason] = (sf.dropReasons[reason] ?? 0) + 1;
  }
}

/** One discovery source's query set, recorded in the artifact verbatim so a
 *  reviewer can replay exactly what was searched. */
export interface DiscoveryDescriptor {
  source: DiscoverySource;
  kind: 'commit-search' | 'pr-search';
  queries: string[];
  aim?: string;
}

export interface BackwardResult {
  entries: BackwardEntry[];
  apiCalls: number;
  /** Discovery items scanned across all sources (name kept for artifact
   *  readers that predate the multi-source widening). */
  revertCommitsScanned: number;
  stoppedReason: 'limit' | 'api-budget' | 'wall-clock' | 'exhausted';
  funnel: BackwardFunnel;
  discovery: DiscoveryDescriptor[];
}

/**
 * Walk one candidate back to its agent attribution and confirm the outcome.
 * Returns null (not an entry) when the blamed commit is not agent-attributed,
 * has no resolvable PR, or the confirmation does not hold. Counts every GitHub
 * call against the shared budget via `spend`. This is the confirmation bar the
 * discovery widening does NOT touch: every source's candidates pass through
 * the same findOutcomeEvidence the corpus labeler uses.
 */
export async function attributeAndConfirm(
  octokit: BackwardOctokit,
  candidate: { repo: string; revertedSha: string; surfacedBy: string; source?: DiscoverySource },
  spend: () => boolean,
  funnel?: BackwardFunnel,
): Promise<BackwardEntry | null> {
  const { owner, repo } = parseRepo(candidate.repo);
  const source = candidate.source ?? 'revert-marker';
  if (funnel !== undefined) funnel.candidatesProcessed += 1;

  if (!spend()) {
    drop(funnel, 'budget-before-pr-lookup', source);
    return null;
  }
  let prs;
  try {
    const res = await withRetry(
      () =>
        octokit.repos.listPullRequestsAssociatedWithCommit({
          owner,
          repo,
          commit_sha: candidate.revertedSha,
        }),
      `listPRs ${candidate.repo}`,
    );
    prs = res.data;
  } catch (err) {
    log.debug(`PR lookup failed for ${candidate.repo}@${candidate.revertedSha.slice(0, 8)}: ${String(err)}`);
    drop(funnel, 'pr-lookup-failed', source);
    return null;
  }
  if (funnel !== undefined) funnel.prLookupResolved += 1;
  const pr = prs.find((p) => p.merged_at !== null && p.merged_at !== undefined) ?? prs[0];

  // Fetch the blamed commit ONCE and reuse it for both attribution (author,
  // message) and confirmation (landedAt, changed ranges). The previous code
  // fetched the same commit twice per candidate, doubling the real API cost of
  // every candidate that passed the PR lookup.
  if (!spend()) {
    drop(funnel, 'budget-before-commit-fetch', source);
    return null;
  }
  let commitMessage = '';
  let commitAuthor = '';
  let landedAt = '';
  let ranges = {};
  let commitResolved = false;
  try {
    const commit = await withRetry(
      () => octokit.repos.getCommit({ owner, repo, ref: candidate.revertedSha }),
      `getCommit ${candidate.repo}`,
    );
    commitMessage = commit.data.commit.message;
    commitAuthor = (commit.data as { author?: { login?: string } }).author?.login ?? '';
    landedAt = commit.data.commit.committer?.date ?? commit.data.commit.author?.date ?? '';
    const patch = (commit.data.files ?? [])
      .map((f) => `diff --git a/${f.filename} b/${f.filename}\n${f.patch ?? ''}`)
      .join('\n');
    ranges = extractChangedLineRanges(patch);
    commitResolved = true;
  } catch (err) {
    log.debug(`commit fetch failed for ${candidate.repo}@${candidate.revertedSha.slice(0, 8)}: ${String(err)}`);
  }
  if (commitResolved && funnel !== undefined) funnel.commitResolved += 1;

  const authors = [pr?.user?.login ?? '', commitAuthor].filter((a) => a.length > 0);
  if (funnel !== undefined && (pr !== undefined || authors.length > 0)) funnel.identifiableAuthor += 1;

  // Attribute from whichever signal we have: the PR (preferred) or the commit.
  const attribution = detectAgent({
    ...(pr !== undefined ? { prTitle: pr.title, prBody: pr.body ?? '', headRef: pr.head.ref } : {}),
    commitMessages: commitMessage.length > 0 ? [commitMessage] : [],
    authors,
  });
  if (attribution === undefined) {
    drop(funnel, 'not-agent-attributed', source);
    return null;
  }
  if (funnel !== undefined) funnel.agentAttributed += 1;

  // Confirm via the shared core: derive the blamed commit's changed ranges and
  // ask findOutcomeEvidence whether history proves it bad. This attaches the same
  // canonical evidence SHAs the labeler writes.
  if (!spend()) {
    drop(funnel, 'budget-before-confirm', source);
    return null;
  }
  const branch = await defaultBranchOf(octokit, candidate.repo);
  if (branch === null) {
    drop(funnel, 'no-default-branch', source);
    return null;
  }
  if (landedAt === '') {
    drop(funnel, 'no-landed-date', source);
    return null;
  }

  if (!spend()) {
    drop(funnel, 'budget-before-confirm', source);
    return null;
  }
  if (funnel !== undefined) funnel.evidenceChecked += 1;
  const confirmed = await findOutcomeEvidence(octokit, {
    repo: candidate.repo,
    headSha: candidate.revertedSha,
    defaultBranch: branch,
    landedAt,
    prRanges: ranges,
    hotfixWindowDays: HOTFIX_WINDOW_DAYS,
  });
  if (confirmed.outcome === 'survived') {
    drop(funnel, 'evidence-survived', source);
    return null;
  }
  if (funnel !== undefined) {
    funnel.evidenceConfirmed += 1;
    sourceFunnel(funnel, source).confirmed += 1;
  }

  return {
    repo: candidate.repo,
    revertedSha: candidate.revertedSha,
    prNumber: pr?.number ?? null,
    vendor: attribution.vendor,
    outcome: confirmed.outcome,
    evidence: confirmed.evidence,
    surfacedBy: candidate.surfacedBy,
    source,
  };
}

/** ISO date `months` months before `now`. */
function sinceDate(now: number, months: number): string {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

function describePlan(plan: DiscoverySourcePlan): DiscoveryDescriptor {
  return plan.kind === 'commit-search'
    ? { source: plan.source, kind: plan.kind, queries: [plan.query] }
    : { source: plan.source, kind: plan.kind, queries: plan.queries, aim: plan.aim };
}

type FlowSignal = 'ok' | 'break-source' | 'break-all';

export async function mineBackward(
  octokit: BackwardOctokit,
  budget: BackwardBudget,
): Promise<BackwardResult> {
  const now = budget.now ?? (() => Date.now());
  const startedAt = now();
  let apiCalls = 0;
  const wallExceeded = (): boolean => now() - startedAt >= budget.wallClockMs;

  const entries: BackwardEntry[] = [];
  const seen = new Set<string>();
  const funnel = emptyFunnel();
  let itemsScanned = 0;
  let stoppedReason: BackwardResult['stoppedReason'] = 'exhausted';
  const since = sinceDate(startedAt, budget.months);
  const plans = buildDiscoveryPlan(since);

  let cumulativeShare = 0;
  plans: for (const plan of plans) {
    cumulativeShare += SOURCE_BUDGET_SHARES[plan.source];
    // Cumulative cap: a source may spend until the run's total reaches its
    // cumulative share of the budget, so slack from a thin earlier source
    // rolls forward instead of going unspent.
    const cap = Math.min(budget.apiBudget, Math.ceil(budget.apiBudget * cumulativeShare));
    const sf = sourceFunnel(funnel, plan.source);
    const spend = (): boolean => {
      if (apiCalls >= cap || wallExceeded()) return false;
      apiCalls += 1;
      return true;
    };
    const gate = (): FlowSignal => {
      if (entries.length >= budget.limit) {
        stoppedReason = 'limit';
        return 'break-all';
      }
      if (apiCalls >= budget.apiBudget) {
        stoppedReason = 'api-budget';
        return 'break-all';
      }
      if (wallExceeded()) {
        stoppedReason = 'wall-clock';
        return 'break-all';
      }
      if (apiCalls >= cap) {
        sf.stopped = 'source-budget';
        return 'break-source';
      }
      return 'ok';
    };
    const handleCandidate = async (candidate: BackwardCandidate): Promise<FlowSignal> => {
      funnel.revertCandidates += 1;
      sf.candidates += 1;
      const key = `${candidate.repo}@${candidate.revertedSha}`;
      if (seen.has(key)) {
        drop(funnel, 'duplicate-candidate', candidate.source);
        return 'ok';
      }
      seen.add(key);
      const flow = gate();
      if (flow !== 'ok') return flow;
      const entry = await attributeAndConfirm(octokit, candidate, spend, funnel);
      if (entry !== null) {
        entries.push(entry);
        log.info(
          `mined ${entry.vendor} ${entry.repo}@${entry.revertedSha.slice(0, 8)} ` +
            `(${entry.outcome}, via ${candidate.source})`,
        );
      }
      return 'ok';
    };

    if (plan.kind === 'commit-search') {
      pages: for (let page = 1; page <= 10; page += 1) {
        const flow = gate();
        if (flow === 'break-all') break plans;
        if (flow === 'break-source') break;
        if (!spend()) break;
        let items: CommitSearchItem[];
        try {
          const res = await withRetry(
            () => octokit.search.commits({ q: plan.query, per_page: 50, page }),
            `discovery ${plan.source} page ${page}`,
          );
          items = res.data.items as CommitSearchItem[];
        } catch (err) {
          log.warn(`${plan.source} search page ${page} failed: ${String(err)}`);
          break;
        }
        if (items.length === 0) break;
        for (const item of items) {
          itemsScanned += 1;
          funnel.revertMarkers += 1;
          sf.markers += 1;
          for (const candidate of plan.extract(item)) {
            const candidateFlow = await handleCandidate(candidate);
            if (candidateFlow === 'break-all') break plans;
            if (candidateFlow === 'break-source') break pages;
          }
        }
      }
    } else {
      queries: for (const query of plan.queries) {
        const flow = gate();
        if (flow === 'break-all') break plans;
        if (flow === 'break-source') break;
        if (!spend()) break;
        let prItems;
        try {
          const res = await withRetry(
            () => octokit.search.issuesAndPullRequests({ q: query, per_page: 20, page: 1 }),
            `discovery ${plan.source}`,
          );
          prItems = res.data.items;
        } catch (err) {
          log.warn(`${plan.source} search failed: ${String(err)}`);
          continue;
        }
        for (const item of prItems) {
          itemsScanned += 1;
          funnel.revertMarkers += 1;
          sf.markers += 1;
          const m = item.html_url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
          if (m === null || m[1] === undefined) continue;
          const repoSlugName = m[1];
          const itemFlow = gate();
          if (itemFlow === 'break-all') break plans;
          if (itemFlow === 'break-source') break queries;
          if (!spend()) break queries;
          const target = parseRepo(repoSlugName);
          let detail;
          try {
            const res = await withRetry(
              () => octokit.pulls.get({ owner: target.owner, repo: target.repo, pull_number: item.number }),
              `pulls.get ${repoSlugName}#${item.number}`,
            );
            detail = res.data;
          } catch (err) {
            log.debug(`PR detail failed for ${repoSlugName}#${item.number}: ${String(err)}`);
            drop(funnel, 'pr-detail-failed', plan.source);
            continue;
          }
          const derived = followupCandidateFromDetail({
            repo: repoSlugName,
            number: item.number,
            url: item.html_url,
            mergedAt: detail.merged_at,
            mergeCommitSha: detail.merge_commit_sha,
            headSha: detail.head.sha,
            authorLogin: detail.user?.login ?? item.user?.login ?? '',
            mergedByLogin: detail.merged_by?.login ?? null,
            reviewCommentCount: detail.review_comments,
          });
          if ('dropReason' in derived) {
            drop(funnel, derived.dropReason, plan.source);
            continue;
          }
          const candidateFlow = await handleCandidate(derived.candidate);
          if (candidateFlow === 'break-all') break plans;
          if (candidateFlow === 'break-source') break queries;
        }
      }
    }
  }

  return {
    entries,
    apiCalls,
    revertCommitsScanned: itemsScanned,
    stoppedReason,
    funnel,
    discovery: plans.map(describePlan),
  };
}

/** Merge new entries into the committed backward corpus, deduped by reverted sha. */
export function mergeCorpus(
  existing: { entries?: BackwardEntry[] } | null,
  fresh: BackwardEntry[],
): BackwardEntry[] {
  const byKey = new Map<string, BackwardEntry>();
  for (const e of existing?.entries ?? []) byKey.set(`${e.repo}@${e.revertedSha}`, e);
  for (const e of fresh) byKey.set(`${e.repo}@${e.revertedSha}`, e);
  return [...byKey.values()].sort((a, b) =>
    a.repo === b.repo ? a.revertedSha.localeCompare(b.revertedSha) : a.repo.localeCompare(b.repo),
  );
}

function parseArgs(argv: string[]): BackwardBudget {
  let apiBudget = 300;
  let wallClockMs = 30 * 60 * 1000;
  let limit = 50;
  let months = 18;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--api-budget' && next !== undefined) (apiBudget = Number(next)), (i += 1);
    else if (a === '--wall-clock-ms' && next !== undefined) (wallClockMs = Number(next)), (i += 1);
    else if (a === '--limit' && next !== undefined) (limit = Number(next)), (i += 1);
    else if (a === '--months' && next !== undefined) (months = Number(next)), (i += 1);
  }
  return { apiBudget, wallClockMs, limit, months };
}

async function main(): Promise<void> {
  loadDotenv();
  const budget = parseArgs(process.argv.slice(2));
  const token = resolveGithubToken();
  if (token === '') {
    log.error('no GitHub token (GITHUB_TOKEN). The live backward mine needs one; running in CI with the secret.');
    process.exitCode = 1;
    return;
  }
  const octokit = makeOctokit(token) as unknown as BackwardOctokit;
  const result = await mineBackward(octokit, budget);

  const existing = fs.existsSync(OUT_FILE)
    ? (JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')) as { entries?: BackwardEntry[] })
    : null;
  const merged = mergeCorpus(existing, result.entries);
  const distribution = { reverted: 0, hotfixed: 0 };
  for (const e of merged) distribution[e.outcome] += 1;
  const sourceDistribution: Record<string, number> = {};
  for (const e of merged) {
    // Pre-widening entries carry no source label; they were all revert-mined.
    const s = e.source ?? 'revert-marker';
    sourceDistribution[s] = (sourceDistribution[s] ?? 0) + 1;
  }
  const out = {
    generatedAt: new Date().toISOString(),
    computedBy: 'scripts/real-prs/mine-backward.ts',
    method:
      'backward: outcome markers (revert, hotfix, issue-linked regression fix, thin-review agent merge) ' +
      '-> blamed agent commit -> findOutcomeEvidence confirmation',
    lastRun: {
      apiCalls: result.apiCalls,
      revertCommitsScanned: result.revertCommitsScanned,
      stoppedReason: result.stoppedReason,
      freshEntries: result.entries.length,
      // Staged funnel: the stage where the count collapses is the diagnosis.
      // `apiCalls` is the budget-unit counter (the guarded spend points per
      // candidate); real GitHub calls are higher because the shared
      // findOutcomeEvidence / defaultBranchOf make their own uncounted requests.
      // `funnel.bySource` splits markers found, candidates derived, entries
      // confirmed, and rejection reasons per discovery source; the flat fields
      // total across sources, so pre-widening readers keep working.
      funnel: result.funnel,
      discovery: result.discovery,
      budgetShares: SOURCE_BUDGET_SHARES,
    },
    total: merged.length,
    distribution,
    sourceDistribution,
    entries: merged,
  };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(out, null, 2)}\n`);
  const f = result.funnel;
  log.info(
    `backward mine: ${result.entries.length} fresh, ${merged.length} total ` +
      `(${result.apiCalls} API calls, stopped: ${result.stoppedReason}) -> ${OUT_FILE}`,
  );
  log.info(
    `funnel: markers=${f.revertMarkers} candidates=${f.revertCandidates} ` +
      `processed=${f.candidatesProcessed} prLookup=${f.prLookupResolved} ` +
      `commit=${f.commitResolved} author=${f.identifiableAuthor} ` +
      `agentAttributed=${f.agentAttributed} evidenceChecked=${f.evidenceChecked} ` +
      `confirmed=${f.evidenceConfirmed}; drops=${JSON.stringify(f.dropReasons)}`,
  );
  for (const [src, sf] of Object.entries(f.bySource)) {
    log.info(
      `source ${src}: markers=${sf.markers} candidates=${sf.candidates} ` +
        `confirmed=${sf.confirmed}${sf.stopped !== undefined ? ` stopped=${sf.stopped}` : ''} ` +
        `drops=${JSON.stringify(sf.dropReasons)}`,
    );
  }
}

if (require.main === module) {
  void main();
}
