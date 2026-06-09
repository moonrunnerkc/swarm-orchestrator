// Build the agent corpus: merged PRs that the shipped pr-source
// fingerprinter attributes to an AI coding agent at high confidence.
// Selection is a global GitHub search per vendor (bot author or body
// marker), then every candidate is confirmed by running detectAgent on
// the PR's real metadata (title, body, branch, commits, authors), so the
// corpus is exactly "PRs the shipped fingerprinter would attribute".
// Writes sources.json plus the raw diffs, in the same shape the clean
// corpus uses, so the audit and arbiter stages run unchanged.
//
// Usage:
//   node dist/scripts/real-prs/fetch-agent-prs.js \
//     [--per-vendor 12] [--min-lines 10] [--max-lines 8000] [--months 12]

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
  type GlobalSearchPr,
} from './lib/github';
import { agentCorpusDir, agentDiffsDir, agentSourcesFile, repoSlug } from './lib/paths';
import type { AgentSourcePr, AgentSourcesFile } from './lib/agent-types';

const log = getLogger('real-prs:fetch-agent');

/** One global search query per vendor. Author queries are exact; marker
 *  queries are the strongest body marker the fingerprinter keys on. The
 *  fingerprinter confirmation pass drops anything the search over-matched. */
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

// Skip our own repos (dogfooding would bias the sample) and forks of this
// project. Anthropic-org repos are skipped for the same arbiter-independence
// reason the clean corpus documents.
const EXCLUDED_OWNERS = new Set(['moonrunnerkc', 'anthropics', 'anthropic-experimental']);

interface Args {
  perVendor: number;
  minLines: number;
  maxLines: number;
  months: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { perVendor: 12, minLines: 10, maxLines: 8_000, months: 12 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--per-vendor' && next !== undefined) (args.perVendor = Number(next)), (i += 1);
    else if (a === '--min-lines' && next !== undefined) (args.minLines = Number(next)), (i += 1);
    else if (a === '--max-lines' && next !== undefined) (args.maxLines = Number(next)), (i += 1);
    else if (a === '--months' && next !== undefined) (args.months = Number(next)), (i += 1);
  }
  return args;
}

function mergedAfterIso(months: number): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - months, now.getDate()).toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  loadDotenv();
  const args = parseArgs(process.argv.slice(2));
  const octokit = makeOctokit(resolveGithubToken());
  const since = mergedAfterIso(args.months);

  const prs: AgentSourcePr[] = [];
  const skipped: Array<{ vendor: string; reason: string; count: number }> = [];
  const seen = new Set<string>();
  fs.mkdirSync(agentDiffsDir(), { recursive: true });

  for (const { vendor, q } of VENDOR_QUERIES) {
    const query = `${q} merged:>=${since}`;
    let candidates: GlobalSearchPr[];
    try {
      // Over-fetch 4x the cap; the band and fingerprinter filters are strict.
      candidates = await searchMergedPrsGlobal(octokit, query, args.perVendor * 4);
    } catch (err) {
      log.warn(`search failed for ${vendor}: ${(err as Error).message}`);
      skipped.push({ vendor, reason: `search failed: ${(err as Error).message}`, count: 0 });
      continue;
    }
    log.info(`${vendor}: ${candidates.length} search candidates`);
    let kept = 0;
    let dropped = 0;
    for (const c of candidates) {
      if (kept >= args.perVendor) break;
      const owner = c.repo.split('/')[0] ?? '';
      if (EXCLUDED_OWNERS.has(owner.toLowerCase())) continue;
      const dedupeKey = `${c.repo}#${c.number}`;
      if (seen.has(dedupeKey)) continue;

      const target = parseRepo(c.repo);
      let detail;
      let commits;
      try {
        detail = await octokit.pulls.get({ owner: target.owner, repo: target.repo, pull_number: c.number });
        commits = await octokit.pulls.listCommits({ owner: target.owner, repo: target.repo, pull_number: c.number, per_page: 100 });
      } catch (err) {
        log.debug(`detail fetch failed for ${dedupeKey}: ${(err as Error).message}`);
        continue;
      }
      const changed = detail.data.additions + detail.data.deletions;
      if (changed < args.minLines || changed > args.maxLines) {
        dropped += 1;
        continue;
      }
      const attribution = detectAgent({
        prTitle: c.title,
        prBody: c.body,
        headRef: detail.data.head.ref,
        commitMessages: commits.data.map((m) => m.commit.message),
        authors: [
          detail.data.user?.login ?? '',
          ...commits.data.map((m) => m.author?.login ?? m.commit.author?.name ?? ''),
        ].filter((a) => a.length > 0),
      });
      if (attribution === undefined || attribution.confidence === 'low') {
        dropped += 1;
        continue;
      }
      let diff: string;
      try {
        diff = await fetchPrDiff(octokit, target, c.number);
      } catch (err) {
        log.debug(`diff fetch failed for ${dedupeKey}: ${(err as Error).message}`);
        continue;
      }
      const slug = repoSlug(c.repo);
      const diffRel = path.join('diffs', slug, `${c.number}.diff`);
      fs.mkdirSync(path.join(agentDiffsDir(), slug), { recursive: true });
      fs.writeFileSync(path.join(agentCorpusDir(), diffRel), diff);
      seen.add(dedupeKey);
      kept += 1;
      prs.push({
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
      log.info(`kept ${dedupeKey} (${attribution.vendor}/${attribution.confidence} via ${attribution.source}, ${changed} lines)`);
    }
    if (dropped > 0) skipped.push({ vendor, reason: 'outside line band or fingerprinter did not confirm', count: dropped });
  }

  const out: AgentSourcesFile = {
    fetchedAt: new Date().toISOString(),
    queries: VENDOR_QUERIES.map((v) => `${v.q} merged:>=${since}`),
    perVendorCap: args.perVendor,
    lineBand: { min: args.minLines, max: args.maxLines },
    skipped,
    prs,
  };
  fs.mkdirSync(agentCorpusDir(), { recursive: true });
  fs.writeFileSync(agentSourcesFile(), JSON.stringify(out, null, 2) + '\n');
  const byVendor = new Map<string, number>();
  for (const p of prs) byVendor.set(p.agent.vendor, (byVendor.get(p.agent.vendor) ?? 0) + 1);
  log.info(`agent corpus: ${prs.length} PRs (${[...byVendor.entries()].map(([v, n]) => `${v}:${n}`).join(', ')})`);
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
