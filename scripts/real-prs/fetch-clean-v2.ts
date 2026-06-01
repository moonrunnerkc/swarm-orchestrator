// Scale the presumed-clean corpus to the ten-repo set so the false-alarm
// rate is measured on a sample large enough to be meaningful (the pilot's
// 18 PRs could not distinguish 2/18 from 3/18). Same selection as the
// pilot fetch (recent merged, non-bot, touches source and test, in a
// changed-line band), but across ten repos at 20+ each, and with every
// PR that appears in the regression corpus excluded so the clean and bad
// corpora never overlap.
//
// Usage:
//   node dist/scripts/real-prs/fetch-clean-v2.js \
//     [--per-repo 25] [--max-prs 250] [--repos a/b,c/d]

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
  type CandidatePr,
  type SelectionCriteria,
} from './lib/github';
import { repoSlugs } from './lib/repos';
import { diffsDir, regressionSourcesFile, repoSlug, sourcesV2File } from './lib/paths';
import type { RegressionSourcesFile, SourcePr, SourcesFile } from './lib/types';

const log = getLogger('real-prs:fetch-v2');

interface Args {
  repos: string[];
  criteria: SelectionCriteria;
  maxPrs: number;
}

function parseArgs(argv: string[]): Args {
  let repos = repoSlugs();
  const criteria: SelectionCriteria = { ...DEFAULT_CRITERIA, perRepoCap: 25 };
  let maxPrs = 250;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--repos' && next !== undefined) (repos = next.split(',').map((r) => r.trim())), (i += 1);
    else if (a === '--per-repo' && next !== undefined) (criteria.perRepoCap = Number(next)), (i += 1);
    else if (a === '--max-prs' && next !== undefined) (maxPrs = Number(next)), (i += 1);
    else if (a === '--min-lines' && next !== undefined) (criteria.minChangedLines = Number(next)), (i += 1);
    else if (a === '--max-lines' && next !== undefined) (criteria.maxChangedLines = Number(next)), (i += 1);
  }
  return { repos, criteria, maxPrs };
}

function bodyExcerpt(body: string, max = 600): string {
  const collapsed = body.replace(/\r\n/g, '\n').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}...` : collapsed;
}

/** Set of `repo#pr` keys in the regression corpus, so the clean corpus
 *  never includes a PR already labeled bad. */
function loadRegressionExclusions(): Set<string> {
  const file = regressionSourcesFile();
  if (!fs.existsSync(file)) return new Set();
  const reg = JSON.parse(fs.readFileSync(file, 'utf8')) as RegressionSourcesFile;
  return new Set(reg.prs.map((p) => `${p.repo}#${p.prNumber}`));
}

async function main(): Promise<void> {
  loadDotenv();
  const args = parseArgs(process.argv.slice(2));
  const token = resolveGithubToken();
  const octokit = makeOctokit(token);
  const exclude = loadRegressionExclusions();
  log.info(`excluding ${exclude.size} regression-corpus PRs from the clean corpus`);

  const query =
    `closed+merged PRs, newest-first, non-bot author, >=1 source file and >=1 test file, ` +
    `${args.criteria.minChangedLines}-${args.criteria.maxChangedLines} changed lines, ` +
    `up to ${args.criteria.perRepoCap}/repo, ${args.maxPrs} total, regression-corpus PRs excluded`;

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
    let found: { prs: CandidatePr[]; scanned: number };
    try {
      // Scan more than the cap so exclusions do not starve a repo.
      found = await listQualifyingMergedPrs(octokit, target, args.criteria, 240);
    } catch (err) {
      const msg = (err as Error).message;
      log.warn(`skipping ${slug}: ${msg}`);
      skippedRepos.push({ repo: slug, reason: msg });
      continue;
    }
    const repoOut = path.join(diffsRoot, repoSlug(slug));
    fs.mkdirSync(repoOut, { recursive: true });
    let kept = 0;
    for (const c of found.prs) {
      if (prs.length >= args.maxPrs) break;
      if (exclude.has(`${slug}#${c.number}`)) continue;
      const rel = path.join('diffs', repoSlug(slug), `${c.number}.diff`);
      const absDiff = path.join(diffsRoot, repoSlug(slug), `${c.number}.diff`);
      // Reuse an already-fetched diff so a re-run does not re-pay; skip a
      // PR whose diff GitHub refuses to render (too large, >300 files)
      // rather than letting one PR abort the whole corpus.
      if (!fs.existsSync(absDiff)) {
        let diff: string;
        try {
          diff = await fetchPrDiff(octokit, target, c.number);
        } catch (err) {
          log.warn(`${slug}#${c.number}: diff fetch failed (${(err as Error).message.slice(0, 80)}); skipping`);
          continue;
        }
        fs.writeFileSync(absDiff, diff);
      }
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
      kept += 1;
    }
    if (kept === 0) {
      skippedRepos.push({ repo: slug, reason: `no qualifying non-excluded PRs in ${found.scanned} scanned` });
    }
    log.info(`  ${slug}: kept ${kept} (total ${prs.length}/${args.maxPrs})`);
  }

  const out: SourcesFile = {
    fetchedAt: new Date().toISOString(),
    query,
    perRepoCap: args.criteria.perRepoCap,
    repos: args.repos,
    skippedRepos,
    prs,
  };
  const outFile = sourcesV2File();
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
  log.info(`wrote ${prs.length} clean PRs across ${args.repos.length} repos to ${outFile}`);
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
