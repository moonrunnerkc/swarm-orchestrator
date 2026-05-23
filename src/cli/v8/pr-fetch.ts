// GitHub-API integration for `swarm audit`. Reads PR metadata, head/base
// SHAs, the unified diff, author identities, and recent commit messages.
// Uses @octokit/rest (already a runtime dep). The `GITHUB_TOKEN` env var
// authenticates if present; without it the call hits the unauthenticated
// rate limit (60/hr), which is fine for one-shot CLI use against a
// public repo.

import { Octokit } from '@octokit/rest';
import { SwarmError } from '../../errors';
import type { AuditInput } from '../../audit/types';

export interface GithubPrRef {
  owner: string;
  repo: string;
  number: number;
}

interface PrContext {
  prMetadata: NonNullable<AuditInput['pr']>;
  fingerprintInput: {
    prTitle: string;
    prBody: string;
    headRef: string;
    authors: string[];
    commitMessages: string[];
  };
}

const URL_RE = /https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\b/;
const SHORT_RE = /^([^/]+)\/([^#]+)#(\d+)$/;

export function parsePrRef(raw: string): GithubPrRef {
  const url = raw.match(URL_RE);
  if (url !== null && url[1] !== undefined && url[2] !== undefined && url[3] !== undefined) {
    return { owner: url[1], repo: url[2], number: Number.parseInt(url[3], 10) };
  }
  const short = raw.match(SHORT_RE);
  if (short !== null && short[1] !== undefined && short[2] !== undefined && short[3] !== undefined) {
    return { owner: short[1], repo: short[2], number: Number.parseInt(short[3], 10) };
  }
  throw new SwarmError(
    `unable to parse PR reference "${raw}"; expected owner/repo#NN or https://github.com/owner/repo/pull/NN`,
    'AUDIT_PR_REF',
    { remediation: 'Try: swarm audit moonrunnerkc/swarm-orchestrator#123' },
  );
}

function client(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  return token !== undefined && token.length > 0 ? new Octokit({ auth: token }) : new Octokit();
}

export async function fetchPrDiffViaGithub(ref: GithubPrRef): Promise<string> {
  const octokit = client();
  try {
    const response = await octokit.pulls.get({
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
      mediaType: { format: 'diff' },
    });
    const data = response.data as unknown;
    if (typeof data !== 'string') {
      throw new SwarmError(
        `GitHub returned a non-diff payload for ${ref.owner}/${ref.repo}#${ref.number}`,
        'AUDIT_PR_FETCH',
      );
    }
    return data;
  } catch (err) {
    // The unified-diff endpoint refuses PRs larger than 300 files
    // (HTTP 406 with code "too_large"). GitHub's documented workaround
    // is the paginated /pulls/N/files endpoint, which returns per-file
    // patch hunks we can splice into a unified diff. Detect that case
    // explicitly and fall back, instead of failing the whole audit.
    if (isDiffTooLarge(err)) {
      return fetchPrDiffViaListFiles(octokit, ref);
    }
    if (err instanceof SwarmError) throw err;
    throw new SwarmError(
      `failed to fetch PR diff for ${ref.owner}/${ref.repo}#${ref.number}: ${(err as Error).message}`,
      'AUDIT_PR_FETCH',
      {
        cause: err,
        remediation: 'Try: set GITHUB_TOKEN, or verify the PR reference exists',
      },
    );
  }
}

interface OctokitErrorShape {
  status?: number;
  message?: string;
  errors?: ReadonlyArray<{ code?: string; field?: string; resource?: string }>;
}

function isDiffTooLarge(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const e = err as OctokitErrorShape;
  if (e.status === 406) return true;
  if (typeof e.message === 'string' && /too[_ ]large|exceeded the maximum number of files/i.test(e.message)) {
    return true;
  }
  if (Array.isArray(e.errors)) {
    for (const inner of e.errors) {
      if (inner?.code === 'too_large') return true;
    }
  }
  return false;
}

interface FileEntryShape {
  filename: string;
  previous_filename?: string;
  status: string; // added | removed | modified | renamed | copied | changed | unchanged
  patch?: string;
}

async function fetchPrDiffViaListFiles(
  octokit: Octokit,
  ref: GithubPrRef,
): Promise<string> {
  try {
    const files = (await octokit.paginate(octokit.pulls.listFiles, {
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
      per_page: 100,
    })) as FileEntryShape[];
    if (files.length === 0) return '';
    const chunks: string[] = [];
    for (const f of files) {
      // listFiles omits `patch` for binary files and for files whose
      // single-file patch exceeds GitHub's per-file truncation limit.
      // Skip those — including a header with no hunks would produce a
      // malformed unified diff downstream.
      if (typeof f.patch !== 'string' || f.patch.length === 0) continue;
      const oldPath = f.status === 'added' ? '/dev/null' : `a/${f.previous_filename ?? f.filename}`;
      const newPath = f.status === 'removed' ? '/dev/null' : `b/${f.filename}`;
      chunks.push(
        `diff --git a/${f.previous_filename ?? f.filename} b/${f.filename}\n` +
          `--- ${oldPath}\n` +
          `+++ ${newPath}\n` +
          (f.patch.endsWith('\n') ? f.patch : `${f.patch}\n`),
      );
    }
    return chunks.join('');
  } catch (err) {
    if (err instanceof SwarmError) throw err;
    throw new SwarmError(
      `failed to fetch PR file list for ${ref.owner}/${ref.repo}#${ref.number}: ${(err as Error).message}`,
      'AUDIT_PR_FETCH',
      {
        cause: err,
        remediation: 'Try: set GITHUB_TOKEN, or verify the PR reference exists',
      },
    );
  }
}

export async function fetchPrContext(ref: GithubPrRef): Promise<PrContext> {
  const octokit = client();
  try {
    const [pr, commits] = await Promise.all([
      octokit.pulls.get({ owner: ref.owner, repo: ref.repo, pull_number: ref.number }),
      octokit.pulls.listCommits({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.number,
        per_page: 100,
      }),
    ]);
    const authors = collectAuthors(pr.data, commits.data);
    const commitMessages = commits.data.map((c) => c.commit?.message ?? '').filter((m) => m.length > 0);
    return {
      prMetadata: {
        number: ref.number,
        headSha: pr.data.head.sha,
        baseSha: pr.data.base.sha,
        title: pr.data.title,
        body: pr.data.body ?? '',
        author: pr.data.user?.login ?? 'unknown',
        headRef: pr.data.head.ref,
        repository: `${ref.owner}/${ref.repo}`,
      },
      fingerprintInput: {
        prTitle: pr.data.title,
        prBody: pr.data.body ?? '',
        headRef: pr.data.head.ref,
        authors,
        commitMessages,
      },
    };
  } catch (err) {
    if (err instanceof SwarmError) throw err;
    throw new SwarmError(
      `failed to fetch PR context for ${ref.owner}/${ref.repo}#${ref.number}: ${(err as Error).message}`,
      'AUDIT_PR_FETCH',
      {
        cause: err,
        remediation: 'Try: set GITHUB_TOKEN, or verify the PR reference exists',
      },
    );
  }
}

interface PrUserShape {
  user: { login: string } | null;
}
interface CommitShape {
  author?: unknown;
  commit?: { author?: unknown };
}

function collectAuthors(pr: PrUserShape, commits: ReadonlyArray<CommitShape>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (login: string | undefined | null): void => {
    if (login === undefined || login === null) return;
    if (seen.has(login)) return;
    seen.add(login);
    out.push(login);
  };
  add(pr.user?.login ?? null);
  for (const c of commits) {
    const authorLogin = readLogin(c.author);
    if (authorLogin !== undefined) add(authorLogin);
    const commitAuthorName = readName(c.commit?.author);
    if (commitAuthorName !== undefined) add(commitAuthorName);
  }
  return out;
}

function readLogin(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const v = (value as { login?: unknown }).login;
  return typeof v === 'string' ? v : undefined;
}

function readName(value: unknown): string | undefined {
  if (value === null || value === undefined || typeof value !== 'object') return undefined;
  const v = (value as { name?: unknown }).name;
  return typeof v === 'string' ? v : undefined;
}
