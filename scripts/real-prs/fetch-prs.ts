// Fetch real merged PRs from public repos into a reproducible corpus.
// Selection: recent merged, non-bot, touches source and test files, in a
// changed-line band. Writes sources.json (with each PR's head SHA so the
// diff is re-fetchable) and the raw diffs under diffs/<repo>/<pr>.diff.
//
// Usage:
//   node dist/scripts/real-prs/fetch-prs.js \
//     [--repos a/b,c/d] [--per-repo 20] [--max-prs 100] \
//     [--min-lines 200] [--max-lines 8000]

import * as fs from 'fs';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import {
  DEFAULT_CRITERIA,
  fetchPrDiff,
  listQualifyingMergedPrs,
  makeOctokit,
  parseRepo,
  resolveGithubToken,
  type SelectionCriteria,
} from './lib/github';
import { diffsDir, repoSlug, sourcesFile } from './lib/paths';
import type { SourcePr, SourcesFile } from './lib/types';

const log = getLogger('real-prs:fetch');

// Avoid Anthropic-affiliated repos to keep arbiter independence cleaner.
const DEFAULT_REPOS = [
  'vitejs/vite',
  'vercel/next.js',
  'withastro/astro',
  'nrwl/nx',
  'trpc/trpc',
];

interface Args {
  repos: string[];
  criteria: SelectionCriteria;
  maxPrs: number;
}

function parseArgs(argv: string[]): Args {
  let repos = DEFAULT_REPOS;
  const criteria: SelectionCriteria = { ...DEFAULT_CRITERIA };
  let maxPrs = 100;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--repos' && next !== undefined) {
      repos = next.split(',').map((r) => r.trim()).filter((r) => r.length > 0);
      i += 1;
    } else if (a === '--per-repo' && next !== undefined) {
      criteria.perRepoCap = Number(next);
      i += 1;
    } else if (a === '--max-prs' && next !== undefined) {
      maxPrs = Number(next);
      i += 1;
    } else if (a === '--min-lines' && next !== undefined) {
      criteria.minChangedLines = Number(next);
      i += 1;
    } else if (a === '--max-lines' && next !== undefined) {
      criteria.maxChangedLines = Number(next);
      i += 1;
    }
  }
  return { repos, criteria, maxPrs };
}

function bodyExcerpt(body: string, max = 600): string {
  const collapsed = body.replace(/\r\n/g, '\n').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}...` : collapsed;
}

async function main(): Promise<void> {
  loadDotenv();
  const args = parseArgs(process.argv.slice(2));
  const token = resolveGithubToken();
  const octokit = makeOctokit(token);

  const query =
    `closed+merged PRs, newest-first, non-bot author, >=1 source file and >=1 test file, ` +
    `${args.criteria.minChangedLines}-${args.criteria.maxChangedLines} changed lines, ` +
    `up to ${args.criteria.perRepoCap}/repo, ${args.maxPrs} total`;

  const prs: SourcePr[] = [];
  const skippedRepos: Array<{ repo: string; reason: string }> = [];
  const diffsRoot = diffsDir();

  for (const slug of args.repos) {
    if (prs.length >= args.maxPrs) {
      skippedRepos.push({ repo: slug, reason: 'overall --max-prs cap reached before this repo' });
      continue;
    }
    const target = parseRepo(slug);
    log.info(`scanning ${slug} ...`);
    let found;
    try {
      found = await listQualifyingMergedPrs(octokit, target, args.criteria);
    } catch (err) {
      const msg = (err as Error).message;
      log.warn(`skipping ${slug}: ${msg}`);
      skippedRepos.push({ repo: slug, reason: msg });
      continue;
    }
    if (found.prs.length === 0) {
      skippedRepos.push({ repo: slug, reason: `no qualifying PRs in ${found.scanned} scanned` });
      continue;
    }
    const repoOut = path.join(diffsRoot, repoSlug(slug));
    fs.mkdirSync(repoOut, { recursive: true });
    for (const c of found.prs) {
      if (prs.length >= args.maxPrs) break;
      const diff = await fetchPrDiff(octokit, target, c.number);
      const rel = path.join('diffs', repoSlug(slug), `${c.number}.diff`);
      fs.writeFileSync(path.join(diffsRoot, repoSlug(slug), `${c.number}.diff`), diff);
      prs.push({
        repo: slug,
        prNumber: c.number,
        headSha: c.headSha,
        title: c.title,
        bodyExcerpt: bodyExcerpt(c.body),
        url: c.url,
        mergedAt: c.mergedAt,
        additions: c.additions,
        deletions: c.deletions,
        files: c.changedFiles,
        diffPath: rel,
      });
    }
    log.info(`  ${slug}: selected ${found.prs.length} (total ${prs.length}/${args.maxPrs})`);
  }

  const out: SourcesFile = {
    fetchedAt: new Date().toISOString(),
    query,
    perRepoCap: args.criteria.perRepoCap,
    repos: args.repos,
    skippedRepos,
    prs,
  };
  const outFile = sourcesFile();
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
  log.info(`wrote ${prs.length} PRs across ${args.repos.length} repos to ${outFile}`);
  if (skippedRepos.length > 0) {
    log.info(`skipped: ${skippedRepos.map((s) => `${s.repo} (${s.reason})`).join('; ')}`);
  }
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
