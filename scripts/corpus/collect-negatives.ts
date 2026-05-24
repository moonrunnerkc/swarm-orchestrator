// Negatives collector. Finds agent PRs for which there is *external*
// evidence of breakage so the corpus gets at least some `broken`-
// verdict entries anchored to facts that aren't this project's
// opinion.
//
// Two evidence types:
//
//   1. closed-without-merge: the GitHub Search query
//      `is:pr is:closed -is:merged author:<bot>` returns PRs the human
//      reviewer rejected. Not every rejection is a cheat (style,
//      duplicate, declined feature, repo doesn't accept bot PRs), but
//      the labeler can read the PR thread to decide. Higher base rate
//      for broken verdicts than a random PR sample.
//
//   2. reverted: a separate PR whose title starts with "Revert" and
//      whose body links back to an original agent PR. The revert
//      commit is GitHub's standard machine-readable "this was bad"
//      signal. We collect the *original* (broken) PR's diff and
//      attribution, not the revert PR.
//
// Output layout under `benchmarks/real-corpus/raw/negatives/`:
//   closed-without-merge/<vendor>/<owner>-<repo>-pr<number>.{json,diff}
//   reverted/<vendor>/<owner>-<repo>-pr<number>.{json,diff}
//
// Idempotent on {repository, pr_number}; reuses the same loader.
// Diffs are vendored alongside the JSON.

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
  globalSearches: { queries: { vendor: string; q: string }[] };
}

interface NegativesArgs {
  since: string;
  seedFile: string;
  outDir: string;
  dryRun: boolean;
  perQueryCap: number;
}

interface CollectorStats {
  inspected: number;
  closedWithoutMergeAccepted: number;
  revertedAccepted: number;
  unconfirmed: number;
  rejected: number;
  skippedExisting: number;
  errors: number;
}

const DEFAULT_PER_QUERY_CAP = 30;
const REVERT_TITLE_RE = /^Revert\s+"(.+)"/;
// Match GitHub's standard revert-body line: "Reverts owner/repo#NN".
const REVERT_BODY_RE = /Reverts\s+([^/\s]+\/[^#\s]+)#(\d+)/;

type EvidenceKind = 'closed-without-merge' | 'reverted';

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const seed = await readSeedFile(args.seedFile);
  const octokit = buildOctokit();
  const stats: CollectorStats = {
    inspected: 0,
    closedWithoutMergeAccepted: 0,
    revertedAccepted: 0,
    unconfirmed: 0,
    rejected: 0,
    skippedExisting: 0,
    errors: 0,
  };

  const closedCandidates = new Map<string, GithubPrRef>();
  const revertedCandidates = new Map<string, GithubPrRef>();

  await gatherClosedWithoutMerge(octokit, seed.globalSearches.queries, args, closedCandidates, stats);
  await gatherReverted(octokit, args, revertedCandidates, stats);

  await processCandidates(closedCandidates, args, stats, 'closed-without-merge');
  await processCandidates(revertedCandidates, args, stats, 'reverted');

  printStats(stats);
}

async function gatherClosedWithoutMerge(
  octokit: Octokit,
  queries: readonly { vendor: string; q: string }[],
  args: NegativesArgs,
  out: Map<string, GithubPrRef>,
  stats: CollectorStats,
): Promise<void> {
  // Only the queries that target a specific bot author yield a useful
  // closed-without-merge signal; body/title-based queries return both
  // merged and unmerged results and would balloon the search budget.
  const authorQueries = queries.filter((q) => q.q.includes('author:'));
  for (const { vendor, q } of authorQueries) {
    const fullQuery = `${q} is:closed -is:merged created:>=${args.since}`;
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
      logWarn(`closed-without-merge search failed for vendor=${vendor}: ${(err as Error).message}`);
      stats.errors += 1;
    }
  }
}

async function gatherReverted(
  octokit: Octokit,
  args: NegativesArgs,
  out: Map<string, GithubPrRef>,
  stats: CollectorStats,
): Promise<void> {
  // Query: PRs whose title starts with "Revert" merged in our window.
  // Read each PR's body for the "Reverts owner/repo#NN" backlink, then
  // attribution-classify the *referenced* original PR. Skip if the
  // original isn't attributable to a known agent.
  const fullQuery = `is:pr is:merged Revert in:title created:>=${args.since}`;
  try {
    const res = await octokit.search.issuesAndPullRequests({
      q: fullQuery,
      per_page: args.perQueryCap,
    });
    const items = (res.data.items ?? []) as {
      html_url?: unknown;
      title?: unknown;
      body?: unknown;
    }[];
    for (const item of items) {
      if (typeof item.title !== 'string' || !REVERT_TITLE_RE.test(item.title)) continue;
      const body = typeof item.body === 'string' ? item.body : '';
      const m = body.match(REVERT_BODY_RE);
      if (m === null || m[1] === undefined || m[2] === undefined) continue;
      const slug = m[1];
      const num = Number.parseInt(m[2], 10);
      if (!Number.isFinite(num)) continue;
      const [owner, repo] = slug.split('/');
      if (owner === undefined || repo === undefined) continue;
      const ref: GithubPrRef = { owner, repo, number: num };
      out.set(refKey(ref), ref);
    }
  } catch (err) {
    logWarn(`reverted search failed: ${(err as Error).message}`);
    stats.errors += 1;
  }
}

async function processCandidates(
  candidates: Map<string, GithubPrRef>,
  args: NegativesArgs,
  stats: CollectorStats,
  kind: EvidenceKind,
): Promise<void> {
  for (const ref of candidates.values()) {
    stats.inspected += 1;
    try {
      const classified = await classifyOne(ref);
      await persistVerdict(ref, classified, args, stats, kind);
    } catch (err) {
      logWarn(`processing ${refKey(ref)} (${kind}) failed: ${(err as Error).message}`);
      stats.errors += 1;
    }
  }
}

async function classifyOne(ref: GithubPrRef): Promise<{
  verdict: AttributionVerdict;
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
  return { verdict, prMetadata: ctx.prMetadata, diff };
}

async function persistVerdict(
  ref: GithubPrRef,
  classified: Awaited<ReturnType<typeof classifyOne>>,
  args: NegativesArgs,
  stats: CollectorStats,
  kind: EvidenceKind,
): Promise<void> {
  const { verdict, prMetadata, diff } = classified;
  if (verdict.kind === 'rejected') {
    stats.rejected += 1;
    return;
  }
  const vendor = verdict.vendor;
  const subdir = path.join(kind, vendor);
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
    agent: { vendor: verdict.vendor, confidence: verdict.confidence, source: verdict.source },
    pr: prMetadata,
    diffRef: {
      repository: `${ref.owner}/${ref.repo}`,
      headSha: prMetadata.headSha,
      baseSha: prMetadata.baseSha,
    },
    vendoredDiffPath: path.posix.join('negatives', kind, vendor, `${id}.diff`),
    vendoredAt: new Date().toISOString(),
    collectedAt: new Date().toISOString(),
  };
  if (args.dryRun) {
    process.stdout.write(`[dry-run] ${kind} ${verdict.kind} ${id} via ${verdict.source}\n`);
  } else {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(jsonPath, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
    await fs.writeFile(diffPath, diff, 'utf8');
  }
  if (verdict.kind === 'accepted') {
    if (kind === 'closed-without-merge') stats.closedWithoutMergeAccepted += 1;
    else stats.revertedAccepted += 1;
  } else {
    stats.unconfirmed += 1;
  }
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
  if (parsed.globalSearches === undefined || !Array.isArray(parsed.globalSearches.queries)) {
    throw new Error(`seed file ${file} is missing globalSearches.queries`);
  }
  return parsed as SeedFile;
}

function buildOctokit(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  return token !== undefined && token.length > 0 ? new Octokit({ auth: token }) : new Octokit();
}

function parseArgs(argv: string[]): NegativesArgs {
  const repoRoot = findRepoRoot(__dirname);
  const defaults: NegativesArgs = {
    since: defaultSinceDate(),
    seedFile: path.join(repoRoot, 'scripts', 'corpus', 'seed-repos.json'),
    outDir: path.join(repoRoot, 'benchmarks', 'real-corpus', 'raw', 'negatives'),
    dryRun: false,
    perQueryCap: DEFAULT_PER_QUERY_CAP,
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
    } else {
      throw new Error(`collect-negatives: unknown argument "${arg ?? ''}"`);
    }
  }
  return defaults;
}

function defaultSinceDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 90);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function requireValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`collect-negatives: ${option} requires a value`);
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
  process.stderr.write(`collect-negatives: ${message}\n`);
}

function printStats(stats: CollectorStats): void {
  process.stdout.write(
    `collect-negatives: inspected=${stats.inspected} ` +
      `cwm-accepted=${stats.closedWithoutMergeAccepted} ` +
      `reverted-accepted=${stats.revertedAccepted} ` +
      `unconfirmed=${stats.unconfirmed} rejected=${stats.rejected} ` +
      `skipped-existing=${stats.skippedExisting} errors=${stats.errors}\n`,
  );
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(`collect-negatives: ${(err as Error).message}\n`);
    process.exitCode = 1;
  });
}
