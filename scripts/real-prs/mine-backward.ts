// Backward mining of outcome-confirmed-bad agent commits.
//
// The forward miner (mine-confirmed-bad.ts) starts from a sample of agent PRs
// and asks "was this later reverted or hotfixed?". It only ever sees the agent
// PRs it happened to fetch. This miner runs the other direction: it starts from
// the BAD OUTCOMES already visible in the wild (revert commits, strong-marker
// hotfix commits), walks back to the commit they undo, and keeps the ones an
// agent authored. Starting from the revert means we find agent-introduced
// defects the forward sample never drew.
//
// Reuse, not fork: the revert/hotfix confirmation is the exact
// `findOutcomeEvidence` the corpus labeler and the forward miner use, so every
// mined entry carries the same canonical evidence SHAs. Agent attribution is the
// same `detectAgent` fingerprinter the audit surface uses.
//
// Bounded by construction: a hard GitHub API-call budget and a wall-clock cap,
// both parameters, so a nightly cron cannot run away. A run that hits either cap
// records how far it got and stops; it never pads.
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
import { makeOctokit, parseRepo, resolveGithubToken, revertedShasInMessage } from './lib/github';
import { extractChangedLineRanges } from '../../src/audit/cheat-detector/diff-walker';
import {
  defaultBranchOf,
  findOutcomeEvidence,
  type OctokitLike,
  type OutcomeEvidence,
} from '../labeling/outcome-labels';

const log = getLogger('real-prs:mine-backward');

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
}

export interface BackwardBudget {
  /** Hard cap on GitHub API calls this run may make. */
  apiBudget: number;
  /** Wall-clock cap (ms). The run stops cleanly when it is reached. */
  wallClockMs: number;
  /** Max confirmed entries to mine (stop early once reached). */
  limit: number;
  /** Only consider reverts on or after this many months ago. */
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
  /** The revert/hotfix commit that surfaced this entry in the backward scan. */
  surfacedBy: string;
}

export interface BackwardResult {
  entries: BackwardEntry[];
  apiCalls: number;
  revertCommitsScanned: number;
  stoppedReason: 'limit' | 'api-budget' | 'wall-clock' | 'exhausted';
}

/** Pure: the (repo, reverted-sha) candidates a revert commit search item yields. */
export function revertCandidatesFromItem(item: {
  repository?: { full_name?: string } | null;
  commit: { message: string };
  sha: string;
}): { repo: string; revertedSha: string; surfacedBy: string }[] {
  const repo = item.repository?.full_name;
  if (repo === undefined || repo === null) return [];
  return revertedShasInMessage(item.commit.message).map((revertedSha) => ({
    repo,
    revertedSha,
    surfacedBy: item.sha,
  }));
}

/**
 * Walk one revert candidate back to its agent attribution and confirm the
 * outcome. Returns null (not an entry) when the reverted commit is not
 * agent-attributed, has no resolvable PR, or the confirmation does not hold.
 * Counts every GitHub call against the shared budget via `spend`.
 */
export async function attributeAndConfirm(
  octokit: BackwardOctokit,
  candidate: { repo: string; revertedSha: string; surfacedBy: string },
  spend: () => boolean,
): Promise<BackwardEntry | null> {
  const { owner, repo } = parseRepo(candidate.repo);

  if (!spend()) return null;
  let prs;
  try {
    const res = await octokit.repos.listPullRequestsAssociatedWithCommit({
      owner,
      repo,
      commit_sha: candidate.revertedSha,
    });
    prs = res.data;
  } catch (err) {
    log.debug(`PR lookup failed for ${candidate.repo}@${candidate.revertedSha.slice(0, 8)}: ${String(err)}`);
    return null;
  }
  const pr = prs.find((p) => p.merged_at !== null && p.merged_at !== undefined) ?? prs[0];

  // Attribute from whichever signal we have: the PR (preferred) or the commit.
  if (!spend()) return null;
  let commitMessage = '';
  let commitAuthor = '';
  try {
    const commit = await octokit.repos.getCommit({ owner, repo, ref: candidate.revertedSha });
    commitMessage = commit.data.commit.message;
    commitAuthor = (commit.data as { author?: { login?: string } }).author?.login ?? '';
  } catch (err) {
    log.debug(`commit fetch failed for ${candidate.repo}@${candidate.revertedSha.slice(0, 8)}: ${String(err)}`);
  }
  const attribution = detectAgent({
    ...(pr !== undefined ? { prTitle: pr.title, prBody: pr.body ?? '', headRef: pr.head.ref } : {}),
    commitMessages: commitMessage.length > 0 ? [commitMessage] : [],
    authors: [pr?.user?.login ?? '', commitAuthor].filter((a) => a.length > 0),
  });
  if (attribution === undefined) return null;

  // Confirm via the shared core: derive the reverted commit's changed ranges and
  // ask findOutcomeEvidence whether history proves it bad. This attaches the same
  // canonical evidence SHAs the labeler writes.
  if (!spend()) return null;
  const branch = await defaultBranchOf(octokit, candidate.repo);
  if (branch === null) return null;
  let landedAt = '';
  let ranges = {};
  try {
    const commit = await octokit.repos.getCommit({ owner, repo, ref: candidate.revertedSha });
    landedAt = commit.data.commit.committer?.date ?? commit.data.commit.author?.date ?? '';
    const patch = (commit.data.files ?? [])
      .map((f) => `diff --git a/${f.filename} b/${f.filename}\n${f.patch ?? ''}`)
      .join('\n');
    ranges = extractChangedLineRanges(patch);
  } catch {
    return null;
  }
  if (landedAt === '') return null;

  if (!spend()) return null;
  const confirmed = await findOutcomeEvidence(octokit, {
    repo: candidate.repo,
    headSha: candidate.revertedSha,
    defaultBranch: branch,
    landedAt,
    prRanges: ranges,
    hotfixWindowDays: HOTFIX_WINDOW_DAYS,
  });
  if (confirmed.outcome === 'survived') return null;

  return {
    repo: candidate.repo,
    revertedSha: candidate.revertedSha,
    prNumber: pr?.number ?? null,
    vendor: attribution.vendor,
    outcome: confirmed.outcome,
    evidence: confirmed.evidence,
    surfacedBy: candidate.surfacedBy,
  };
}

/** ISO date `months` months before `now`. */
function sinceDate(now: number, months: number): string {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

export async function mineBackward(
  octokit: BackwardOctokit,
  budget: BackwardBudget,
): Promise<BackwardResult> {
  const now = budget.now ?? (() => Date.now());
  const startedAt = now();
  let apiCalls = 0;
  const spend = (): boolean => {
    if (apiCalls >= budget.apiBudget) return false;
    if (now() - startedAt >= budget.wallClockMs) return false;
    apiCalls += 1;
    return true;
  };

  const entries: BackwardEntry[] = [];
  const seen = new Set<string>();
  let revertCommitsScanned = 0;
  let stoppedReason: BackwardResult['stoppedReason'] = 'exhausted';
  const since = sinceDate(startedAt, budget.months);
  const query = `"This reverts commit" committer-date:>=${since}`;

  for (let page = 1; page <= 10; page += 1) {
    if (entries.length >= budget.limit) {
      stoppedReason = 'limit';
      break;
    }
    if (!spend()) {
      stoppedReason = apiCalls >= budget.apiBudget ? 'api-budget' : 'wall-clock';
      break;
    }
    let items;
    try {
      const res = await octokit.search.commits({ q: query, per_page: 50, page });
      items = res.data.items as Array<{
        sha: string;
        commit: { message: string };
        repository?: { full_name?: string } | null;
      }>;
    } catch (err) {
      log.warn(`revert search page ${page} failed: ${String(err)}`);
      break;
    }
    if (items.length === 0) {
      stoppedReason = 'exhausted';
      break;
    }
    for (const item of items) {
      revertCommitsScanned += 1;
      for (const candidate of revertCandidatesFromItem(item)) {
        if (entries.length >= budget.limit) {
          stoppedReason = 'limit';
          break;
        }
        if (seen.has(`${candidate.repo}@${candidate.revertedSha}`)) continue;
        seen.add(`${candidate.repo}@${candidate.revertedSha}`);
        if (now() - startedAt >= budget.wallClockMs || apiCalls >= budget.apiBudget) {
          stoppedReason = apiCalls >= budget.apiBudget ? 'api-budget' : 'wall-clock';
          break;
        }
        const entry = await attributeAndConfirm(octokit, candidate, spend);
        if (entry !== null) {
          entries.push(entry);
          log.info(`mined ${entry.vendor} ${entry.repo}@${entry.revertedSha.slice(0, 8)} (${entry.outcome})`);
        }
      }
      if (stoppedReason === 'limit' || stoppedReason === 'api-budget' || stoppedReason === 'wall-clock') break;
    }
    if (stoppedReason !== 'exhausted') break;
  }

  return { entries, apiCalls, revertCommitsScanned, stoppedReason };
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
  const out = {
    generatedAt: new Date().toISOString(),
    computedBy: 'scripts/real-prs/mine-backward.ts',
    method: 'backward: revert markers -> reverted agent commit -> findOutcomeEvidence confirmation',
    lastRun: {
      apiCalls: result.apiCalls,
      revertCommitsScanned: result.revertCommitsScanned,
      stoppedReason: result.stoppedReason,
      freshEntries: result.entries.length,
    },
    total: merged.length,
    distribution,
    entries: merged,
  };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(out, null, 2)}\n`);
  log.info(
    `backward mine: ${result.entries.length} fresh, ${merged.length} total ` +
      `(${result.apiCalls} API calls, stopped: ${result.stoppedReason}) -> ${OUT_FILE}`,
  );
}

if (require.main === module) {
  void main();
}
