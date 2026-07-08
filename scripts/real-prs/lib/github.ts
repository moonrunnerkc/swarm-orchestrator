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
  user?: { login?: string } | null;
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
  await awaitThrottle();
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

// Global throttle shared by every withRetry caller in the process. GitHub's
// secondary (abuse) rate limit is burst-triggered: once tripped, hammering the
// next call keeps it hot, so per-call backoff alone tarpits (every subsequent
// call eats its own 62s backoff then skips, doing no useful work). The fix is a
// PROCESS-WIDE cooldown plus a small inter-call gap, so a burst is paced out and
// a trip makes ALL callers wait, letting the abuse flag cool.
const MIN_CALL_GAP_MS = 90;
let nextAllowedAt = 0;

async function awaitThrottle(): Promise<void> {
  const now = Date.now();
  const waitFor = nextAllowedAt - now;
  if (waitFor > 0) await sleep(waitFor);
  // Reserve the next slot so concurrent-ish callers space themselves out.
  nextAllowedAt = Math.max(nextAllowedAt, Date.now()) + MIN_CALL_GAP_MS;
}

/**
 * Retry a GitHub call through GitHub's secondary rate limit (burst-triggered,
 * separate from the primary hourly quota), honoring Retry-After, and pace all
 * calls through a shared throttle so a burst never trips the limit in the first
 * place. Without the throttle a bounded rapid-fire run tarpits: each call eats a
 * full backoff then skips, blowing the wall clock with no progress. Primary-quota
 * exhaustion is the caller's budget concern and is not retried here.
 */
export async function withRetry<T>(fn: () => Promise<T>, label: string, attempt = 0): Promise<T> {
  await awaitThrottle();
  try {
    return await fn();
  } catch (err) {
    const status = (err as { status?: number }).status;
    const headers = (err as { response?: { headers?: Record<string, string> } }).response?.headers;
    const retryAfter = Number(headers?.['retry-after']);
    const remaining = Number(headers?.['x-ratelimit-remaining']);
    // PRIMARY quota exhaustion (x-ratelimit-remaining: 0) does NOT recover until
    // the hourly reset, so retrying is futile and only multiplies real calls (the
    // very thing that drained the quota). Throw immediately; the caller skips and
    // the run finishes assembly with what it has. Only the SECONDARY (abuse) limit
    // — burst-triggered, recovers in seconds — is worth backing off and retrying.
    if (remaining === 0) {
      log.warn(`${label}: primary rate limit exhausted (remaining 0); not retrying until hourly reset`);
      throw err;
    }
    if ((status === 403 || status === 429) && attempt < 6) {
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2_000 * 2 ** attempt;
      // Push the global cooldown forward so every other caller also waits; this is
      // what actually lets the secondary limit reset instead of re-tripping it.
      nextAllowedAt = Date.now() + waitMs;
      log.warn(`${label} hit a secondary rate limit; global cooldown ${waitMs}ms (attempt ${attempt + 1})`);
      await sleep(waitMs);
      return withRetry(fn, label, attempt + 1);
    }
    throw err;
  }
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
  /** The PR author's login, from the search item. Empty when the search API
   *  omits the user. Carried so a consumer can feed the fingerprinter its
   *  highest-confidence signal (bot-author) without a second fetch. */
  author: string;
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
      out.push({ repo: m[1] as string, number: item.number, title: item.title, body: item.body, url: item.html_url, author: item.user?.login ?? '' });
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

// --- Complaint mining -----------------------------------------------------
//
// Maintainers catch agent cheats in review and say so in plain language. A
// review comment that says "you just changed the test" or "this doesn't actually
// fix it" on an agent-attributed PR is a human-labeled wild cheat, before any
// proof runs. This is the richest vein, and it includes closed-without-merge PRs
// (exactly where a caught cheat gets rejected and documented). The patterns map
// each complaint to the cheat category it names, so a hit can be cross-checked
// against the structural detector that should have fired on the same diff.

export type ComplaintCategory =
  | 'test-relaxation'
  | 'assertion-strip'
  | 'no-op-fix'
  | 'goal-not-fixed'
  | 'mock-of-hallucination'
  | 'error-swallow'
  | 'coverage-erosion'
  | 'fake-refactor'
  | 'hardcoded-output';

interface ComplaintPattern {
  re: RegExp;
  category: ComplaintCategory;
}

/** Maintainer-complaint phrasings, each tagged with the cheat category it names.
 *  Tuned to be specific: a phrase has to assert the cheat, not merely mention a
 *  test or a mock. Ordered by category for readability, not precedence. */
export const CHEAT_COMPLAINT_PATTERNS: ComplaintPattern[] = [
  // The agent edited the test instead of the code.
  { re: /you (?:just |simply |only )?(?:changed|modified|edited|altered|rewrote) the test/i, category: 'test-relaxation' },
  { re: /(?:changed|modified|edited|adjusted) the test(?:s)? (?:to|so it|so they|just to)\b.{0,20}\bpass/i, category: 'test-relaxation' },
  { re: /(?:weaken|loosen|relax)(?:ed|ing)? the test/i, category: 'test-relaxation' },
  { re: /(?:skipp?ed|disabled|commented out|deleted|removed) the (?:failing |broken )?test/i, category: 'test-relaxation' },
  { re: /test(?:s)? (?:were|was|is|are) (?:changed|weakened|gutted|neutered) (?:just )?to (?:make (?:it|them) )?pass/i, category: 'test-relaxation' },
  { re: /just to make (?:the |it |them )?tests? pass/i, category: 'test-relaxation' },
  // The agent removed or weakened an assertion.
  { re: /(?:removed?|deleted|dropped|stripped|got rid of) the (?:assertion|assert|expect|check)/i, category: 'assertion-strip' },
  { re: /(?:weakened|loosened) the assertion/i, category: 'assertion-strip' },
  { re: /no longer (?:asserts?|checks?|verif)/i, category: 'assertion-strip' },
  // The change does not actually fix the problem.
  { re: /(?:doesn'?t|does not|didn'?t|did not) (?:actually|really|truly) (?:fix|solve|address)/i, category: 'goal-not-fixed' },
  { re: /this (?:doesn'?t|does not) (?:fix|solve|address)\b/i, category: 'goal-not-fixed' },
  { re: /(?:not|isn'?t) (?:a )?(?:real|actual|proper) fix/i, category: 'no-op-fix' },
  { re: /this is a no.?op/i, category: 'no-op-fix' },
  { re: /(?:still|doesn'?t) (?:repro|reproduces|fail|fails|broken|not fixed)/i, category: 'goal-not-fixed' },
  // The agent mocked the thing under test / a hallucinated symbol.
  { re: /(?:don'?t|do not|shouldn'?t|should not|please don'?t) mock(?:ing)? (?:this|that|it|the)/i, category: 'mock-of-hallucination' },
  { re: /(?:stop|avoid) mock(?:ing)?\b/i, category: 'mock-of-hallucination' },
  { re: /mocking the (?:thing|code|function|module|implementation) (?:you'?re|under|being) (?:test|测试)/i, category: 'mock-of-hallucination' },
  { re: /(?:mock|stub)(?:s|ed|ing)? (?:a |the )?(?:non-?existent|nonexistent|hallucinated|made-up|imaginary)/i, category: 'mock-of-hallucination' },
  // The agent swallowed or hid an error.
  { re: /this (?:hides|masks|swallows|suppresses) the (?:error|exception|failure)/i, category: 'error-swallow' },
  { re: /(?:swallow|suppress)(?:s|ed|ing)? the (?:error|exception)/i, category: 'error-swallow' },
  { re: /(?:silently |just )(?:ignor|swallow|catch)(?:es|ing)? (?:the )?(?:error|exception|it)/i, category: 'error-swallow' },
  { re: /empty catch (?:block)?/i, category: 'error-swallow' },
  // Coverage / fake refactor / hardcoding.
  { re: /(?:removed|deleted|reduced|lowered) (?:the )?(?:test )?coverage/i, category: 'coverage-erosion' },
  { re: /this (?:isn'?t|is not) (?:really |actually |a )?(?:refactor|refactoring)/i, category: 'fake-refactor' },
  { re: /hard.?cod(?:e|ed|ing) (?:the )?(?:expected|value|output|result|return|answer)/i, category: 'hardcoded-output' },
  { re: /(?:just |simply )?return(?:ing|s)? (?:a |the )?hard.?coded/i, category: 'hardcoded-output' },
];

/** Phrase queries for the GitHub `in:comments` PR search. Each is a high-signal
 *  exact phrase that GitHub phrase-matching handles well; a hit is then verified
 *  locally with CHEAT_COMPLAINT_PATTERNS against the fetched conversation and the
 *  PR is attributed before it counts. */
export const COMPLAINT_SEARCH_PHRASES: string[] = [
  'you just changed the test',
  'changed the test to pass',
  'just to make the test pass',
  'removed the assertion',
  'no longer asserts',
  "doesn't actually fix",
  'does not actually fix',
  "this doesn't fix",
  'not a real fix',
  'this is a no-op',
  "don't mock this",
  'stop mocking',
  'mocking the function under test',
  'this hides the error',
  'swallows the error',
  'empty catch block',
  "this isn't a refactor",
  'hardcoded the expected',
];

export interface ComplaintSignal {
  category: ComplaintCategory;
  /** The matched substring, for an auditable link from complaint to category. */
  phrase: string;
  /** Where it was found: 'review' | 'review-comment' | 'issue-comment'. */
  source: string;
}

/**
 * Pure extraction of cheat-complaint signals from one block of conversation
 * text. Returns one signal per (category, matched-phrase) so a comment that
 * names two distinct cheats yields two signals. Separated from the network walk
 * so the matching is unit-tested against real maintainer phrasings.
 */
export function extractComplaintSignals(text: string, source = 'comment'): ComplaintSignal[] {
  const out: ComplaintSignal[] = [];
  const seen = new Set<string>();
  for (const { re, category } of CHEAT_COMPLAINT_PATTERNS) {
    const m = re.exec(text);
    if (m === null) continue;
    const key = `${category}:${m[0].toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ category, phrase: m[0], source });
  }
  return out;
}

/** One conversation entry on a PR: a review body, a review (inline) comment, or
 *  an issue comment. The body is what the complaint matcher scans. */
export interface ConversationEntry {
  source: 'review' | 'review-comment' | 'issue-comment';
  author: string;
  body: string;
}

/**
 * Fetch a PR's full human conversation: review summaries, inline review
 * comments, and issue comments. Bot authors are dropped (a maintainer complaint
 * has to come from a human). Used both to verify a global comment-search hit and
 * to scan every fetched agent PR for complaints the search missed.
 */
export async function fetchPrConversation(
  octokit: Octokit,
  target: RepoTarget,
  prNumber: number,
): Promise<ConversationEntry[]> {
  const entries: ConversationEntry[] = [];
  const pushIf = (source: ConversationEntry['source'], author: string, body: string | null | undefined): void => {
    if (body === null || body === undefined || body.trim().length === 0) return;
    if (BOT_AUTHOR.test(author)) return;
    entries.push({ source, author, body });
  };
  try {
    const reviews = await octokit.paginate(octokit.pulls.listReviews, {
      owner: target.owner,
      repo: target.repo,
      pull_number: prNumber,
      per_page: 100,
    });
    for (const r of reviews) pushIf('review', r.user?.login ?? '', r.body);
  } catch (err) {
    log.debug(`listReviews failed for ${target.owner}/${target.repo}#${prNumber}: ${(err as Error).message}`);
  }
  try {
    const rc = await octokit.paginate(octokit.pulls.listReviewComments, {
      owner: target.owner,
      repo: target.repo,
      pull_number: prNumber,
      per_page: 100,
    });
    for (const c of rc) pushIf('review-comment', c.user?.login ?? '', c.body);
  } catch (err) {
    log.debug(`listReviewComments failed for ${target.owner}/${target.repo}#${prNumber}: ${(err as Error).message}`);
  }
  try {
    const ic = await octokit.paginate(octokit.issues.listComments, {
      owner: target.owner,
      repo: target.repo,
      issue_number: prNumber,
      per_page: 100,
    });
    for (const c of ic) pushIf('issue-comment', c.user?.login ?? '', c.body);
  } catch (err) {
    log.debug(`listComments failed for ${target.owner}/${target.repo}#${prNumber}: ${(err as Error).message}`);
  }
  return entries;
}

/** The deeper agent-attribution signals a PR carries beyond its title and body:
 *  the head branch name and the commit-message trailers. Fetched on demand for a
 *  PR whose title/body/author did not already attribute it, so the fingerprinter
 *  can match a `codex/` branch or a `Co-Authored-By: Claude` trailer. */
export interface PrAgentSignals {
  headRef: string;
  commitMessages: string[];
}

/**
 * Fetch a PR's head branch and commit messages for a deep agent-attribution pass.
 * One `pulls.get` (head ref) plus the first page of `listCommits` (messages); it
 * does not paginate commits, since an agent trailer appears on every commit it
 * authored, so the first page is sufficient to attribute.
 *
 * @param octokit an authenticated client.
 * @param target the owner/repo.
 * @param prNumber the PR number.
 * @returns the head ref and up to 100 commit messages (empty on a fetch error).
 */
export async function fetchPrAgentSignals(
  octokit: Octokit,
  target: RepoTarget,
  prNumber: number,
): Promise<PrAgentSignals> {
  let headRef = '';
  let commitMessages: string[] = [];
  try {
    const pr = await octokit.pulls.get({ owner: target.owner, repo: target.repo, pull_number: prNumber });
    headRef = pr.data.head?.ref ?? '';
  } catch (err) {
    log.debug(`pulls.get head for ${target.owner}/${target.repo}#${prNumber}: ${(err as Error).message}`);
  }
  try {
    const commits = await octokit.pulls.listCommits({ owner: target.owner, repo: target.repo, pull_number: prNumber, per_page: 100 });
    commitMessages = commits.data.map((c) => c.commit.message);
  } catch (err) {
    log.debug(`listCommits for ${target.owner}/${target.repo}#${prNumber}: ${(err as Error).message}`);
  }
  return { headRef, commitMessages };
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
