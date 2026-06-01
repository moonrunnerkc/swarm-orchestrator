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

function isTestFile(filename: string): boolean {
  return TEST_FILE.test(filename) || TEST_NAME.test(filename);
}

function isSourceFile(filename: string): boolean {
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
