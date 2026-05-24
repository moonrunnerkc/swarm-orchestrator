// Real-PR collector for the v10.1 leaderboard. Walks a seed list of
// vendor-showcase repos plus a set of global GitHub searches keyed by
// agent signature, applies the two-signal attribution rule from
// `agent-signatures.ts`, and writes one `PrCorpusEntry` JSON file +
// one vendored fallback `.diff` per accepted PR.
//
// Output layout under `benchmarks/real-corpus/raw/`:
//   <vendor>/<owner>-<repo>-pr<number>.json     (entry envelope)
//   <vendor>/<owner>-<repo>-pr<number>.diff     (vendored fallback diff)
//   unconfirmed/<vendor>/...                    (single-signal candidates)
//
// Idempotent on `{repository, pr_number}` — re-running skips entries
// already present. Reuses `src/cli/v8/pr-fetch.ts` for PR context and
// diff fetching; this script does not reimplement Octokit pagination.
//
// Run: `npm run corpus:collect-real -- --since 2026-02-23`

import * as fs from 'fs/promises';
import * as path from 'path';
import { Octokit } from '@octokit/rest';
import {
  fetchPrContext,
  fetchPrDiffViaGithub,
  parsePrRef,
  type GithubPrRef,
} from '../../src/cli/v8/pr-fetch';
import {
  attributeAgent,
  type AttributionVerdict,
  type PrSignalInput,
} from './agent-signatures';
import { findRepoRoot } from './repo-root';
import {
  buildPrEntryId,
  type UnlabeledPrCorpusEntry,
} from '../../benchmarks/real-corpus/schema';

interface SeedFile {
  vendorShowcaseRepos: { vendor: string; repo: string }[];
  standingFollowRepos: { repo: string }[];
  globalSearches: { queries: { vendor: string; q: string }[] };
}

interface CollectorArgs {
  since: string;
  seedFile: string;
  outDir: string;
  dryRun: boolean;
  perQueryCap: number;
  perRepoCap: number;
}

interface CollectorStats {
  inspected: number;
  accepted: number;
  unconfirmed: number;
  rejected: number;
  skippedExisting: number;
  errors: number;
}

const DEFAULT_PER_QUERY_CAP = 100;
const DEFAULT_PER_REPO_CAP = 50;

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const seed = await readSeedFile(args.seedFile);
  const octokit = buildOctokit();
  const stats: CollectorStats = {
    inspected: 0,
    accepted: 0,
    unconfirmed: 0,
    rejected: 0,
    skippedExisting: 0,
    errors: 0,
  };
  const candidates = new Map<string, GithubPrRef>();
  await gatherFromSearches(octokit, seed.globalSearches.queries, args, candidates, stats);
  await gatherFromShowcaseRepos(
    octokit,
    [
      ...seed.vendorShowcaseRepos.map((r) => r.repo),
      ...seed.standingFollowRepos.map((r) => r.repo),
    ],
    args,
    candidates,
    stats,
  );
  await processCandidates(candidates, args, stats);
  printStats(stats);
}

async function gatherFromSearches(
  octokit: Octokit,
  queries: readonly { vendor: string; q: string }[],
  args: CollectorArgs,
  out: Map<string, GithubPrRef>,
  stats: CollectorStats,
): Promise<void> {
  for (const { vendor, q } of queries) {
    const fullQuery = `${q} created:>=${args.since}`;
    try {
      const res = await octokit.search.issuesAndPullRequests({
        q: fullQuery,
        per_page: args.perQueryCap,
      });
      const items = (res.data.items ?? []) as { html_url?: unknown; pull_request?: unknown }[];
      for (const item of items) {
        const ref = refFromSearchItem(item);
        if (ref === null) continue;
        out.set(refKey(ref), ref);
      }
    } catch (err) {
      logWarn(`search failed for vendor=${vendor}: ${(err as Error).message}`);
      stats.errors += 1;
    }
  }
}

async function gatherFromShowcaseRepos(
  octokit: Octokit,
  repos: readonly string[],
  args: CollectorArgs,
  out: Map<string, GithubPrRef>,
  stats: CollectorStats,
): Promise<void> {
  for (const repoSlug of repos) {
    const [owner, repo] = repoSlug.split('/');
    if (owner === undefined || repo === undefined) {
      logWarn(`malformed seed repo entry "${repoSlug}"; expected owner/repo`);
      continue;
    }
    try {
      const list = await octokit.pulls.list({
        owner,
        repo,
        state: 'all',
        sort: 'created',
        direction: 'desc',
        per_page: Math.min(args.perRepoCap, 100),
      });
      for (const pr of list.data) {
        if (typeof pr.number !== 'number') continue;
        if (pr.created_at < args.since) continue;
        out.set(refKey({ owner, repo, number: pr.number }), { owner, repo, number: pr.number });
      }
    } catch (err) {
      logWarn(`pulls.list failed for ${repoSlug}: ${(err as Error).message}`);
      stats.errors += 1;
    }
  }
}

async function processCandidates(
  candidates: Map<string, GithubPrRef>,
  args: CollectorArgs,
  stats: CollectorStats,
): Promise<void> {
  for (const ref of candidates.values()) {
    stats.inspected += 1;
    try {
      const verdict = await classifyOne(ref);
      await persistVerdict(ref, verdict, args, stats);
    } catch (err) {
      logWarn(`processing ${refKey(ref)} failed: ${(err as Error).message}`);
      stats.errors += 1;
    }
  }
}

async function classifyOne(ref: GithubPrRef): Promise<{
  verdict: AttributionVerdict;
  signal: PrSignalInput;
  prMetadata: import('../../benchmarks/real-corpus/schema').PrMetadata;
  diff: string;
}> {
  const ctx = await fetchPrContext(ref);
  const signal: PrSignalInput = {
    prTitle: ctx.fingerprintInput.prTitle,
    prBody: ctx.fingerprintInput.prBody,
    headRef: ctx.fingerprintInput.headRef,
    authors: ctx.fingerprintInput.authors,
    commitMessages: ctx.fingerprintInput.commitMessages,
    repository: `${ref.owner}/${ref.repo}`,
  };
  const verdict = attributeAgent(signal);
  const diff = verdict.kind === 'rejected' ? '' : await fetchPrDiffViaGithub(ref);
  return { verdict, signal, prMetadata: ctx.prMetadata, diff };
}

async function persistVerdict(
  ref: GithubPrRef,
  classified: Awaited<ReturnType<typeof classifyOne>>,
  args: CollectorArgs,
  stats: CollectorStats,
): Promise<void> {
  const { verdict, prMetadata, diff } = classified;
  if (verdict.kind === 'rejected') {
    stats.rejected += 1;
    return;
  }
  const vendor = verdict.vendor;
  const subdir = verdict.kind === 'accepted' ? vendor : path.join('unconfirmed', vendor);
  const dir = path.join(args.outDir, subdir);
  const id = buildPrEntryId(vendor, `${ref.owner}/${ref.repo}`, ref.number);
  const jsonPath = path.join(dir, `${id}.json`);
  const diffPath = path.join(dir, `${id}.diff`);
  if (await pathExists(jsonPath)) {
    stats.skippedExisting += 1;
    return;
  }
  const entry: UnlabeledPrCorpusEntry = {
    id,
    agent: {
      vendor: verdict.vendor,
      confidence: verdict.confidence,
      source: verdict.source,
    },
    pr: prMetadata,
    diffRef: {
      repository: `${ref.owner}/${ref.repo}`,
      headSha: prMetadata.headSha,
      baseSha: prMetadata.baseSha,
    },
    vendoredDiffPath: path.posix.join(subdir, `${id}.diff`),
    vendoredAt: new Date().toISOString(),
    collectedAt: new Date().toISOString(),
  };
  if (args.dryRun) {
    process.stdout.write(`[dry-run] ${verdict.kind} ${id} via ${verdict.source}\n`);
  } else {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(jsonPath, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
    await fs.writeFile(diffPath, diff, 'utf8');
  }
  if (verdict.kind === 'accepted') stats.accepted += 1;
  else stats.unconfirmed += 1;
}

function refFromSearchItem(item: { html_url?: unknown; pull_request?: unknown }): GithubPrRef | null {
  if (item.pull_request === undefined || item.pull_request === null) return null;
  if (typeof item.html_url !== 'string') return null;
  try {
    return parsePrRef(item.html_url);
  } catch {
    return null;
  }
}

function refKey(ref: GithubPrRef): string {
  return `${ref.owner}/${ref.repo}#${ref.number}`;
}

async function readSeedFile(file: string): Promise<SeedFile> {
  const text = await fs.readFile(file, 'utf8');
  const parsed = JSON.parse(text) as Partial<SeedFile>;
  if (
    !Array.isArray(parsed.vendorShowcaseRepos) ||
    !Array.isArray(parsed.standingFollowRepos) ||
    parsed.globalSearches === undefined ||
    !Array.isArray(parsed.globalSearches.queries)
  ) {
    throw new Error(`seed file ${file} is missing required arrays`);
  }
  return parsed as SeedFile;
}

function buildOctokit(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  return token !== undefined && token.length > 0 ? new Octokit({ auth: token }) : new Octokit();
}

function parseArgs(argv: string[]): CollectorArgs {
  const repoRoot = findRepoRoot(__dirname);
  const defaults: CollectorArgs = {
    since: defaultSinceDate(),
    seedFile: path.join(repoRoot, 'scripts', 'corpus', 'seed-repos.json'),
    outDir: path.join(repoRoot, 'benchmarks', 'real-corpus', 'raw'),
    dryRun: false,
    perQueryCap: DEFAULT_PER_QUERY_CAP,
    perRepoCap: DEFAULT_PER_REPO_CAP,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      defaults.dryRun = true;
    } else if (arg === '--since') {
      defaults.since = requireValue(argv, (i += 1), '--since');
    } else if (arg === '--seed-file') {
      defaults.seedFile = path.resolve(requireValue(argv, (i += 1), '--seed-file'));
    } else if (arg === '--out-dir') {
      defaults.outDir = path.resolve(requireValue(argv, (i += 1), '--out-dir'));
    } else if (arg === '--per-query-cap') {
      defaults.perQueryCap = Number.parseInt(requireValue(argv, (i += 1), '--per-query-cap'), 10);
    } else if (arg === '--per-repo-cap') {
      defaults.perRepoCap = Number.parseInt(requireValue(argv, (i += 1), '--per-repo-cap'), 10);
    } else {
      throw new Error(`collect-real: unknown argument "${arg ?? ''}"`);
    }
  }
  return defaults;
}

function defaultSinceDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function requireValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`collect-real: ${option} requires a value`);
  }
  return value;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function logWarn(message: string): void {
  process.stderr.write(`collect-real: ${message}\n`);
}

function printStats(stats: CollectorStats): void {
  process.stdout.write(
    `collect-real: inspected=${stats.inspected} accepted=${stats.accepted} ` +
      `unconfirmed=${stats.unconfirmed} rejected=${stats.rejected} ` +
      `skippedExisting=${stats.skippedExisting} errors=${stats.errors}\n`,
  );
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(`collect-real: ${(err as Error).message}\n`);
    process.exitCode = 1;
  });
}
