// Part B: mine agent-attributed PRs that are OUTCOME-confirmed bad.
//
// The agent-incidence fetcher already builds a corpus of merged, fingerprinted
// agent PRs (agent-corpus/sources.json + diffs). This stage runs Part A's
// outcome detector over that corpus (and, with --fetch-more, an additional
// bounded batch fetched the same way) and keeps only the PRs repository history
// proves bad: reverted or hotfixed. The point is a positive class large enough
// to measure detector precision at the corpus's true base rate without
// human labeling or synthetic injection.
//
// Reuse, not fork: outcome detection is the exact `findOutcomeEvidence` the
// corpus labeler uses; fetching reuses the agent-incidence search + fingerprint
// + diff helpers.
//
// Target: >= 50 confirmed-bad. If the bounded mine yields fewer, that ceiling
// is recorded, not padded.
//
// Usage:
//   node dist/scripts/real-prs/mine-confirmed-bad.js [--fetch-more N] [--months 18] [--refresh]

import * as fs from 'fs';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { detectAgent } from '../../src/audit/pr-source';
import {
  fetchPrDiff,
  makeOctokit,
  parseRepo,
  resolveGithubToken,
  searchMergedPrsGlobal,
} from './lib/github';
import { agentCorpusDir, agentDiffsDir, agentSourcesFile, repoSlug } from './lib/paths';
import type { AgentSourcePr, AgentSourcesFile } from './lib/agent-types';
import { extractChangedLineRanges } from '../../src/audit/cheat-detector/diff-walker';
import {
  defaultBranchOf,
  findOutcomeEvidence,
  type OctokitLike,
  type OutcomeEvidence,
} from '../labeling/outcome-labels';

const log = getLogger('real-prs:mine-bad');

const TARGET_CONFIRMED_BAD = 50;
const HOTFIX_WINDOW_DAYS = 30;
const CACHE_DIR = path.join('benchmarks', 'real-prs', 'agent-corpus', 'outcome-cache');
const OUT_FILE = path.join('benchmarks', 'real-prs', 'agent-corpus', 'confirmed-bad.json');

// Same vendor queries the agent-incidence fetcher uses, so --fetch-more grows
// the corpus the same way it was built. Kept local to avoid exporting the
// fetcher's internals.
const VENDOR_QUERIES: ReadonlyArray<{ vendor: string; q: string }> = [
  { vendor: 'devin', q: 'is:pr is:merged author:devin-ai-integration[bot]' },
  { vendor: 'claude-code', q: 'is:pr is:merged "Generated with Claude Code" in:body' },
  { vendor: 'cursor', q: 'is:pr is:merged head:cursor/' },
  { vendor: 'codex-cli', q: 'is:pr is:merged head:codex/' },
  { vendor: 'copilot-workspace', q: 'is:pr is:merged author:copilot-swe-agent[bot]' },
  { vendor: 'openhands', q: 'is:pr is:merged author:openhands-agent[bot]' },
  { vendor: 'aider', q: 'is:pr is:merged "aider.chat" in:body' },
  { vendor: 'replit-agent', q: 'is:pr is:merged author:replit-agent[bot]' },
];

const EXCLUDED_OWNERS = new Set(['moonrunnerkc', 'anthropics', 'anthropic-experimental']);

interface Args {
  fetchMore: number;
  months: number;
  refresh: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { fetchMore: 0, months: 18, refresh: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--fetch-more' && next !== undefined) (args.fetchMore = Number(next)), (i += 1);
    else if (a === '--months' && next !== undefined) (args.months = Number(next)), (i += 1);
    else if (a === '--refresh') args.refresh = true;
  }
  return args;
}

function readJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

interface OutcomeRecord {
  repo: string;
  prNumber: number;
  headSha: string;
  vendor: string;
  outcome: 'reverted' | 'hotfixed' | 'survived' | 'indeterminate';
  indeterminateReason?: string;
  evidence: OutcomeEvidence[];
}

function statusOf(err: unknown): number | undefined {
  return (err as { status?: number }).status;
}

function loadAgentDiff(pr: AgentSourcePr): string | null {
  const p = path.join(agentCorpusDir(), pr.diffPath);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

async function resolveAgentPr(octokit: OctokitLike, pr: AgentSourcePr): Promise<OutcomeRecord> {
  const base = { repo: pr.repo, prNumber: pr.prNumber, headSha: pr.headSha, vendor: pr.agent.vendor };
  if (pr.mergedAt.length === 0) {
    return { ...base, outcome: 'indeterminate', indeterminateReason: 'no merge date in source', evidence: [] };
  }
  const defaultBranch = await defaultBranchOf(octokit, pr.repo);
  if (defaultBranch === null) {
    return { ...base, outcome: 'indeterminate', indeterminateReason: 'repo inaccessible', evidence: [] };
  }
  const diff = loadAgentDiff(pr);
  const prRanges = diff !== null ? extractChangedLineRanges(diff) : {};
  try {
    const found = await findOutcomeEvidence(octokit, {
      repo: pr.repo,
      headSha: pr.headSha,
      defaultBranch,
      landedAt: pr.mergedAt,
      prRanges,
      hotfixWindowDays: HOTFIX_WINDOW_DAYS,
    });
    return { ...base, outcome: found.outcome, evidence: found.evidence };
  } catch (err) {
    return {
      ...base,
      outcome: 'indeterminate',
      indeterminateReason: `resolution failed (HTTP ${statusOf(err) ?? '?'})`,
      evidence: [],
    };
  }
}

function mergedAfterIso(months: number): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - months, now.getDate()).toISOString().slice(0, 10);
}

/** Fetch additional agent PRs (same selection as the incidence fetcher),
 *  dedup against what is already on disk, append to the corpus. Returns the
 *  grown source list. Bounded by `want` kept PRs across all vendors. */
async function fetchMore(
  octokit: ReturnType<typeof makeOctokit>,
  existing: AgentSourcePr[],
  want: number,
  months: number,
): Promise<AgentSourcePr[]> {
  const since = mergedAfterIso(months);
  const seen = new Set(existing.map((p) => `${p.repo}#${p.prNumber}`));
  const grown = [...existing];
  let kept = 0;
  const perVendorWant = Math.ceil(want / VENDOR_QUERIES.length);
  for (const { vendor, q } of VENDOR_QUERIES) {
    if (kept >= want) break;
    let candidates;
    try {
      candidates = await searchMergedPrsGlobal(octokit, `${q} merged:>=${since}`, perVendorWant * 5);
    } catch (err) {
      log.warn(`search failed for ${vendor}: ${(err as Error).message}`);
      continue;
    }
    let keptVendor = 0;
    for (const c of candidates) {
      if (kept >= want || keptVendor >= perVendorWant) break;
      const owner = c.repo.split('/')[0] ?? '';
      if (EXCLUDED_OWNERS.has(owner.toLowerCase())) continue;
      if (seen.has(`${c.repo}#${c.number}`)) continue;
      const target = parseRepo(c.repo);
      let detail;
      let commits;
      try {
        detail = await octokit.pulls.get({ owner: target.owner, repo: target.repo, pull_number: c.number });
        commits = await octokit.pulls.listCommits({ owner: target.owner, repo: target.repo, pull_number: c.number, per_page: 100 });
      } catch {
        continue;
      }
      const changed = detail.data.additions + detail.data.deletions;
      if (changed < 10 || changed > 8_000) continue;
      const attribution = detectAgent({
        prTitle: c.title,
        prBody: c.body,
        headRef: detail.data.head.ref,
        commitMessages: commits.data.map((m) => m.commit.message),
        authors: [detail.data.user?.login ?? '', ...commits.data.map((m) => m.author?.login ?? '')].filter((a) => a.length > 0),
      });
      if (attribution === undefined || attribution.confidence === 'low') continue;
      let diff: string;
      try {
        diff = await fetchPrDiff(octokit, target, c.number);
      } catch {
        continue;
      }
      const slug = repoSlug(c.repo);
      const diffRel = path.join('diffs', slug, `${c.number}.diff`);
      fs.mkdirSync(path.join(agentDiffsDir(), slug), { recursive: true });
      fs.writeFileSync(path.join(agentCorpusDir(), diffRel), diff);
      seen.add(`${c.repo}#${c.number}`);
      grown.push({
        repo: c.repo,
        prNumber: c.number,
        headSha: detail.data.head.sha,
        title: c.title,
        bodyExcerpt: c.body.slice(0, 2_000),
        url: c.url,
        mergedAt: detail.data.merged_at ?? '',
        additions: detail.data.additions,
        deletions: detail.data.deletions,
        files: detail.data.changed_files,
        diffPath: diffRel,
        agent: attribution,
        searchVendor: vendor,
      });
      kept += 1;
      keptVendor += 1;
    }
    log.info(`${vendor}: kept ${keptVendor} new (total new ${kept}/${want})`);
  }
  return grown;
}

async function main(): Promise<void> {
  loadDotenv();
  const args = parseArgs(process.argv.slice(2));
  const octokit = makeOctokit(resolveGithubToken());

  const sources = readJson<AgentSourcesFile>(agentSourcesFile());
  let prs = sources?.prs ?? [];
  log.info(`loaded ${prs.length} agent PRs from the existing corpus`);

  if (args.fetchMore > 0) {
    prs = await fetchMore(octokit, prs, args.fetchMore, args.months);
    if (sources !== null) {
      writeJson(agentSourcesFile(), { ...sources, prs });
      log.info(`grew agent corpus to ${prs.length} PRs`);
    }
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const records: OutcomeRecord[] = [];
  let queried = 0;
  for (const pr of prs) {
    const key = `${repoSlug(pr.repo)}-pr${pr.prNumber}`;
    const cacheFile = path.join(CACHE_DIR, `${key}.json`);
    if (!args.refresh) {
      const cached = readJson<OutcomeRecord>(cacheFile);
      if (cached !== null) {
        records.push(cached);
        continue;
      }
    }
    const rec = await resolveAgentPr(octokit as unknown as OctokitLike, pr);
    writeJson(cacheFile, rec);
    records.push(rec);
    queried += 1;
    if (queried % 10 === 0) log.info(`resolved ${records.length}/${prs.length} (${queried} live)`);
  }

  const bad = records.filter((r) => r.outcome === 'reverted' || r.outcome === 'hotfixed');
  const dist = { reverted: 0, hotfixed: 0, survived: 0, indeterminate: 0 };
  for (const r of records) dist[r.outcome] += 1;

  const out = {
    generatedAt: new Date().toISOString(),
    computedBy: 'scripts/real-prs/mine-confirmed-bad.ts',
    target: TARGET_CONFIRMED_BAD,
    pool: records.length,
    confirmedBad: bad.length,
    reachedTarget: bad.length >= TARGET_CONFIRMED_BAD,
    ceilingNote:
      bad.length >= TARGET_CONFIRMED_BAD
        ? `reached the ${TARGET_CONFIRMED_BAD} target`
        : `bounded mine of ${records.length} agent PRs yielded ${bad.length} outcome-confirmed-bad ` +
          `(${((bad.length / Math.max(1, records.length - dist.indeterminate)) * 100).toFixed(1)}% of usable); ` +
          `below the ${TARGET_CONFIRMED_BAD} target — grow with --fetch-more to scan further`,
    distribution: dist,
    confirmedBadPrs: bad,
  };
  writeJson(OUT_FILE, out);
  log.info(
    `confirmed-bad: ${bad.length}/${TARGET_CONFIRMED_BAD} target over ${records.length} agent PRs ` +
      `(reverted=${dist.reverted} hotfixed=${dist.hotfixed} survived=${dist.survived} indet=${dist.indeterminate}); wrote ${OUT_FILE}`,
  );
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
