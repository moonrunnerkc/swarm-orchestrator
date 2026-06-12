// GitHub access for the real-PR harness: resolve a token, list recent
// merged PRs that meet the corpus criteria, and fetch raw unified diffs.
// Uses @octokit/rest (already a dependency) and the existing env-loader
// chain, falling back to the gh CLI keyring so a developer logged in via
// `gh auth login` does not have to copy a token into .env.

import { execFileSync } from 'child_process';
import { Octokit } from '@octokit/rest';
import { SwarmError } from '../../../src/errors';
import { getLogger } from '../../../src/logger';

const log = getLogger('real-prs:github');

const BOT_AUTHOR = /(\[bot\]$)|^(dependabot|renovate|github-actions|greenkeeper|snyk-bot)/i;

const TEST_FILE = /(^|\/)(__tests__|__test__)\//i;
const TEST_NAME = /\.(test|spec)\.[cm]?[jt]sx?$/i;
const SOURCE_EXT = /\.[cm]?[jt]sx?$/i;

export interface RepoTarget {
  owner: string;
  repo: string;
}

export function parseRepo(slug: string): RepoTarget {
  const m = slug.trim().match(/^([^/\s]+)\/([^/\s]+)$/);
  if (m === null || m[1] === undefined || m[2] === undefined) {
    throw new SwarmError(`not a valid owner/repo: ${slug}`, 'REAL_PRS_BAD_REPO', {
      remediation: 'Pass repos as owner/repo, e.g. vitejs/vite.',
    });
  }
  return { owner: m[1], repo: m[2] };
}

export function resolveGithubToken(): string {
  const fromEnv = process.env.GITHUB_TOKEN;
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  try {
    const fromGh = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
    if (fromGh.length > 0) {
      log.info('using GitHub token from the gh CLI keyring (GITHUB_TOKEN not set in env)');
      return fromGh;
    }
  } catch (err) {
    log.debug(`gh auth token unavailable: ${(err as Error).message}`);
  }
  throw new SwarmError('no GitHub token available', 'REAL_PRS_NO_GITHUB_TOKEN', {
    remediation:
      'set GITHUB_TOKEN in .env, or run `gh auth login` so the harness can read it from the keyring.',
  });
}

export function makeOctokit(token: string): Octokit {
  return new Octokit({ auth: token });
}

export function isTestFile(filename: string): boolean {
  return TEST_FILE.test(filename) || TEST_NAME.test(filename);
}

export function isSourceFile(filename: string): boolean {
  if (isTestFile(filename)) return false;
  if (!SOURCE_EXT.test(filename)) return false;
  // Exclude obvious non-source code files.
  if (/(^|\/)(dist|build|node_modules|coverage|fixtures?)\//i.test(filename)) return false;
  if (/\.d\.ts$/.test(filename)) return false;
  return true;
}

export interface CandidatePr {
  number: number;
  title: string;
  body: string;
  author: string;
  mergedAt: string;
  headSha: string;
  url: string;
  additions: number;
  deletions: number;
  changedFiles: number;
}

export interface SelectionCriteria {
  minChangedLines: number;
  maxChangedLines: number;
  perRepoCap: number;
}

export const DEFAULT_CRITERIA: SelectionCriteria = {
  minChangedLines: 200,
  maxChangedLines: 8_000,
  perRepoCap: 20,
};

/**
 * Walk the most recently updated closed PRs for a repo and return the
 * first `perRepoCap` that were merged, are not bot-authored, touch at
 * least one source file and one test file, and have a changed-line count
 * inside the configured band. Scans newest-first and stops once the cap
 * is met or the scan budget is exhausted.
 */
export async function listQualifyingMergedPrs(
  octokit: Octokit,
  target: RepoTarget,
  criteria: SelectionCriteria,
  maxScan = 120,
): Promise<{ prs: CandidatePr[]; scanned: number }> {
  const selected: CandidatePr[] = [];
  let scanned = 0;
  const iterator = octokit.paginate.iterator(octokit.pulls.list, {
    owner: target.owner,
    repo: target.repo,
    state: 'closed',
    sort: 'updated',
    direction: 'desc',
    per_page: 50,
  });
  for await (const page of iterator) {
    for (const pr of page.data) {
      if (selected.length >= criteria.perRepoCap || scanned >= maxScan) {
        return { prs: selected, scanned };
      }
      if (pr.merged_at === null || pr.merged_at === undefined) continue;
      scanned += 1;
      const author = pr.user?.login ?? '';
      if (BOT_AUTHOR.test(author)) continue;
      const detail = await octokit.pulls.get({
        owner: target.owner,
        repo: target.repo,
        pull_number: pr.number,
      });
      const additions = detail.data.additions;
      const deletions = detail.data.deletions;
      const changed = additions + deletions;
      if (changed < criteria.minChangedLines || changed > criteria.maxChangedLines) continue;
      const files = await octokit.paginate(octokit.pulls.listFiles, {
        owner: target.owner,
        repo: target.repo,
        pull_number: pr.number,
        per_page: 100,
      });
      const names = files.map((f) => f.filename);
      const hasSource = names.some(isSourceFile);
      const hasTest = names.some(isTestFile);
      if (!hasSource || !hasTest) continue;
      selected.push({
        number: pr.number,
        title: pr.title,
        body: pr.body ?? '',
        author,
        mergedAt: pr.merged_at,
        headSha: detail.data.head.sha,
        url: pr.html_url,
        additions,
        deletions,
        changedFiles: detail.data.changed_files,
      });
    }
  }
  return { prs: selected, scanned };
}

// --- Regression mining ----------------------------------------------------

/** A merged PR that a later artifact (a revert, a fix-PR, a hotfix, or an
 *  issue) points at as the thing that broke. `mentionedInBody` is the
 *  exact text that names the bad PR so the link is auditable. */
export interface RegressionSignal {
  /** The number of the PR that is being labeled bad. */
  badPrNumber: number;
  kind: 'revert' | 'fix-pr' | 'hotfix' | 'issue';
  /** The proving artifact's URL (the revert/fix PR, or the issue). */
  url: string;
  /** SHA of the proving artifact's merge commit when known. */
  sha: string | null;
  mentionedInBody: string;
}

/** Phrases in a PR title/body that name an earlier broken PR. The capture
 *  group is the referenced PR number. Ordered most-specific first. */
const FIX_REFERENCE_PATTERNS: RegExp[] = [
  /regression (?:from|introduced in|caused by) #(\d+)/gi,
  /(?:broke|broken by|breaks) #(\d+)/gi,
  /introduced (?:in|by) #(\d+)/gi,
];

/** `Reverts #N` in a revert PR body. */
const REVERT_PR_NUMBER = /reverts?\s+#(\d+)/gi;

interface SearchIssueItem {
  number: number;
  title: string;
  body: string;
  html_url: string;
}

/**
 * Pure extraction of retrospective-bad signals from one proving PR's text.
 * A revert PR (title starting "Revert") that names "Reverts #N" labels PR N
 * bad; a fix-PR whose body says "regression from #N" / "broken by #N" /
 * "introduced in #N" labels PR N bad. Self-references are dropped.
 * Separated from the network walk so the matching is unit-tested.
 */
export function extractRegressionSignals(item: SearchIssueItem): RegressionSignal[] {
  const out: RegressionSignal[] = [];
  const hay = `${item.title}\n${item.body}`;
  const isRevertTitle = /^revert\b/i.test(item.title);
  const seen = new Set<string>();
  const push = (bad: number, kind: 'revert' | 'fix-pr', text: string): void => {
    const key = `${kind}:${bad}`;
    if (bad !== item.number && !seen.has(key)) {
      seen.add(key);
      out.push({ badPrNumber: bad, kind, url: item.html_url, sha: null, mentionedInBody: text });
    }
  };
  if (isRevertTitle) {
    REVERT_PR_NUMBER.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = REVERT_PR_NUMBER.exec(hay)) !== null) push(Number(m[1]), 'revert', m[0]);
  }
  for (const re of FIX_REFERENCE_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(hay)) !== null) push(Number(m[1]), isRevertTitle ? 'revert' : 'fix-pr', m[0]);
  }
  return out;
}

/**
 * Search a repo's merged PRs for retrospective-bad signals: revert PRs
 * and fix-PRs whose title or body names an earlier merged PR. Returns one
 * signal per (badPrNumber, provingPr). Uses the GitHub search API, which
 * is rate-limited to 30 req/min, so callers should mine repos serially.
 */
export async function mineRegressionSignals(
  octokit: Octokit,
  target: RepoTarget,
  windowMonths: number,
  perRepoScan = 200,
): Promise<RegressionSignal[]> {
  const since = monthsAgoIso(windowMonths);
  const slug = `${target.owner}/${target.repo}`;
  const queries = [
    `repo:${slug} is:pr is:merged in:title revert merged:>=${since}`,
    `repo:${slug} is:pr is:merged regression merged:>=${since}`,
    `repo:${slug} is:pr is:merged "broken by" merged:>=${since}`,
    `repo:${slug} is:pr is:merged "introduced in" merged:>=${since}`,
  ];
  const signals: RegressionSignal[] = [];
  const seen = new Set<string>();
  let scanned = 0;
  for (const q of queries) {
    let page = 1;
    while (scanned < perRepoScan) {
      const items = await searchIssuesWithRetry(octokit, q, page);
      if (items.length === 0) break;
      for (const item of items) {
        scanned += 1;
        for (const sig of extractRegressionSignals(item)) {
          const key = `${sig.kind}:${sig.badPrNumber}`;
          if (!seen.has(key)) {
            seen.add(key);
            signals.push(sig);
          }
        }
        if (scanned >= perRepoScan) break;
      }
      if (items.length < 100) break;
      page += 1;
    }
  }
  return signals;
}

async function searchIssuesWithRetry(
  octokit: Octokit,
  q: string,
  page: number,
  attempt = 0,
): Promise<SearchIssueItem[]> {
  try {
    const res = await octokit.search.issuesAndPullRequests({ q, per_page: 100, page });
    return res.data.items.map((i) => ({
      number: i.number,
      title: i.title,
      body: i.body ?? '',
      html_url: i.html_url,
    }));
  } catch (err) {
    const status = (err as { status?: number }).status;
    if ((status === 403 || status === 429) && attempt < 5) {
      const waitMs = 3_000 * 2 ** attempt;
      log.warn(`search rate-limited (${status}); backing off ${waitMs}ms`);
      await sleep(waitMs);
      return searchIssuesWithRetry(octokit, q, page, attempt + 1);
    }
    throw err;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One PR returned by a global (cross-repo) search. The repo slug is
 *  parsed from the result URL because the search API does not return a
 *  repository object on issue items. */
export interface GlobalSearchPr {
  repo: string;
  number: number;
  title: string;
  body: string;
  url: string;
}

/**
 * Run a global `is:pr` search and return up to `cap` results across all
 * repos, newest-first. Used by the agent-corpus fetcher, whose selection
 * is by author/marker rather than per-repo listing. Retries on
 * rate-limit like the regression miner.
 */
export async function searchMergedPrsGlobal(
  octokit: Octokit,
  q: string,
  cap: number,
): Promise<GlobalSearchPr[]> {
  const out: GlobalSearchPr[] = [];
  for (let page = 1; out.length < cap && page <= 10; page += 1) {
    const items = await searchIssuesWithRetry(octokit, q, page);
    if (items.length === 0) break;
    for (const item of items) {
      const m = item.html_url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
      if (m === null) continue;
      out.push({ repo: m[1] as string, number: item.number, title: item.title, body: item.body, url: item.html_url });
      if (out.length >= cap) break;
    }
  }
  return out;
}

function monthsAgoIso(months: number): string {
  const now = new Date();
  const then = new Date(now.getFullYear(), now.getMonth() - months, now.getDate());
  return then.toISOString().slice(0, 10);
}

/**
 * Fetch enough detail about a candidate bad PR to decide whether it
 * belongs in the corpus: that it was merged, is not bot-authored, touches
 * at least one source file, and its changed-line count is inside a band.
 * Returns null when the PR does not qualify or cannot be fetched.
 */
export async function fetchBadPrDetail(
  octokit: Octokit,
  target: RepoTarget,
  prNumber: number,
  maxChangedLines = 8_000,
  minChangedLines = 10,
): Promise<{ pr: CandidatePr; filenames: string[] } | null> {
  let detail;
  try {
    detail = await octokit.pulls.get({ owner: target.owner, repo: target.repo, pull_number: prNumber });
  } catch (err) {
    log.debug(`bad-PR detail unavailable for #${prNumber}: ${(err as Error).message}`);
    return null;
  }
  const d = detail.data;
  if (d.merged_at === null || d.merged_at === undefined) return null;
  const author = d.user?.login ?? '';
  if (BOT_AUTHOR.test(author)) return null;
  const changed = d.additions + d.deletions;
  if (changed < minChangedLines || changed > maxChangedLines) return null;
  const files = await octokit.paginate(octokit.pulls.listFiles, {
    owner: target.owner,
    repo: target.repo,
    pull_number: prNumber,
    per_page: 100,
  });
  const filenames = files.map((f) => f.filename);
  if (!filenames.some(isSourceFile)) return null;
  return {
    pr: {
      number: d.number,
      title: d.title,
      body: d.body ?? '',
      author,
      mergedAt: d.merged_at,
      headSha: d.head.sha,
      url: d.html_url,
      additions: d.additions,
      deletions: d.deletions,
      changedFiles: d.changed_files,
    },
    filenames,
  };
}

export type RegressionBucket =
  | 'test-changed-no-code-fix'
  | 'code-change-missed-bug'
  | 'covered-behavior-regressed'
  | 'other';

/** Classify a bad PR into a cheat-relevant stratification bucket from its
 *  changed file list. Coarse but auditable: keys on whether the PR touched
 *  tests, source, or neither. */
export function bucketFromFilenames(names: string[]): RegressionBucket {
  const touchedTest = names.some(isTestFile);
  const touchedSource = names.some(isSourceFile);
  if (touchedTest && !touchedSource) return 'test-changed-no-code-fix';
  if (touchedSource && touchedTest) return 'covered-behavior-regressed';
  if (touchedSource) return 'code-change-missed-bug';
  return 'other';
}

/** `This reverts commit <sha>` is the message git writes for a `git revert`.
 *  Capture group is the reverted commit sha (full 40-hex or abbreviated). */
const REVERTS_COMMIT_RE = /this reverts commit ([0-9a-f]{7,40})/gi;

/**
 * Extract every commit sha a commit message claims to revert. Shared so the
 * outcome-label deriver and any future caller detect reverts the same way the
 * block path detects revert PRs — by the artifact git itself writes, not a
 * bespoke regex per call site.
 *
 * @param message a commit message
 * @returns the lower-cased reverted shas named in the message
 */
export function revertedShasInMessage(message: string): string[] {
  const out: string[] = [];
  REVERTS_COMMIT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REVERTS_COMMIT_RE.exec(message)) !== null) {
    if (m[1] !== undefined) out.push(m[1].toLowerCase());
  }
  return out;
}

/** True when `message` reverts `sha` (matching on the abbreviated prefix, the
 *  form git records when the original was abbreviated). */
export function messageRevertsSha(message: string, sha: string): boolean {
  const target = sha.toLowerCase();
  return revertedShasInMessage(message).some(
    (r) => target.startsWith(r) || r.startsWith(target),
  );
}

/** Fetch the raw unified diff for a PR. */
export async function fetchPrDiff(octokit: Octokit, target: RepoTarget, prNumber: number): Promise<string> {
  const res = await octokit.pulls.get({
    owner: target.owner,
    repo: target.repo,
    pull_number: prNumber,
    mediaType: { format: 'diff' },
  });
  // With the diff media type octokit returns the raw text as `data`.
  return res.data as unknown as string;
}
