// Mine a corpus of merged PRs that later proved wrong. For each repo we
// search merged PRs for retrospective-bad signals (a revert PR, or a
// fix-PR whose body names an earlier broken PR), resolve each referenced
// PR's detail and diff, and write a labeled-bad record with its proof
// link attached. The proof is what makes "did the auditor catch a real
// cheat in the wild" answerable: every bad PR points at the revert or
// fix that demonstrates it was wrong.
//
// Usage:
//   node dist/scripts/real-prs/mine-regressions.js \
//     [--window-months 12] [--per-repo-floor 3] [--repos a/b,c/d]

import * as fs from 'fs';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import {
  bucketFromFilenames,
  fetchBadPrDetail,
  fetchPrDiff,
  makeOctokit,
  mineRegressionSignals,
  parseRepo,
  resolveGithubToken,
  type RegressionSignal,
} from './lib/github';
import { ALL_REPOS, repoSlugs } from './lib/repos';
import { regressionDiffsDir, regressionSourcesFile, repoSlug } from './lib/paths';
import type { RegressionCategory, RegressionPr, RegressionProof, RegressionSourcesFile } from './lib/types';

const log = getLogger('real-prs:mine');

interface Args {
  windowMonths: number;
  perRepoFloor: number;
  repos: string[];
}

function parseArgs(argv: string[]): Args {
  let windowMonths = 12;
  let perRepoFloor = 3;
  let repos = repoSlugs();
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--window-months' && next !== undefined) (windowMonths = Number(next)), (i += 1);
    else if (a === '--per-repo-floor' && next !== undefined) (perRepoFloor = Number(next)), (i += 1);
    else if (a === '--repos' && next !== undefined) (repos = next.split(',').map((s) => s.trim())), (i += 1);
  }
  return { windowMonths, perRepoFloor, repos };
}

function bodyExcerpt(body: string, max = 600): string {
  const trimmed = body.replace(/\r\n/g, '\n').trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/** Group signals by the bad PR they name, collecting every proof. */
function groupByBadPr(signals: RegressionSignal[]): Map<number, RegressionProof[]> {
  const out = new Map<number, RegressionProof[]>();
  for (const s of signals) {
    const proofs = out.get(s.badPrNumber) ?? [];
    proofs.push({ kind: s.kind, url: s.url, sha: s.sha, mentionedInBody: s.mentionedInBody });
    out.set(s.badPrNumber, proofs);
  }
  return out;
}

async function mineRepo(
  token: string,
  slug: string,
  windowMonths: number,
): Promise<{ prs: RegressionPr[]; reason: string }> {
  const octokit = makeOctokit(token);
  const target = parseRepo(slug);
  const signals = await mineRegressionSignals(octokit, target, windowMonths);
  const grouped = groupByBadPr(signals);
  log.info(`${slug}: ${signals.length} signals naming ${grouped.size} distinct bad PRs`);
  const prs: RegressionPr[] = [];
  for (const [badPr, proofs] of grouped) {
    const detail = await fetchBadPrDetail(octokit, target, badPr);
    if (detail === null) continue;
    const { pr, filenames } = detail;
    let diff: string;
    try {
      diff = await fetchPrDiff(octokit, target, badPr);
    } catch (err) {
      log.warn(`${slug}#${badPr}: diff fetch failed: ${(err as Error).message}`);
      continue;
    }
    const relDiff = path.join('diffs', repoSlug(slug), `${badPr}.diff`);
    const absDiff = path.join(regressionDiffsDir(), repoSlug(slug), `${badPr}.diff`);
    fs.mkdirSync(path.dirname(absDiff), { recursive: true });
    fs.writeFileSync(absDiff, diff);
    const category: RegressionCategory = bucketFromFilenames(filenames);
    prs.push({
      repo: slug,
      prNumber: badPr,
      headSha: pr.headSha,
      title: pr.title,
      bodyExcerpt: bodyExcerpt(pr.body),
      url: pr.url,
      mergedAt: pr.mergedAt,
      additions: pr.additions,
      deletions: pr.deletions,
      files: pr.changedFiles,
      diffPath: relDiff,
      category,
      proofs,
    });
  }
  return { prs, reason: `${signals.length} signals, ${prs.length} qualified` };
}

async function main(): Promise<void> {
  loadDotenv();
  const args = parseArgs(process.argv.slice(2));
  const token = resolveGithubToken();

  const all: RegressionPr[] = [];
  const shortRepos: RegressionSourcesFile['shortRepos'] = [];
  for (const slug of args.repos) {
    let windowMonths = args.windowMonths;
    let { prs, reason } = await mineRepo(token, slug, windowMonths);
    // Widen the window to 24 months for a repo that comes up short.
    if (prs.length < args.perRepoFloor && windowMonths < 24) {
      windowMonths = 24;
      log.info(`${slug}: only ${prs.length} < floor ${args.perRepoFloor}; widening to 24 months`);
      ({ prs, reason } = await mineRepo(token, slug, windowMonths));
    }
    if (prs.length < args.perRepoFloor) {
      shortRepos.push({ repo: slug, found: prs.length, reason });
    }
    all.push(...prs);
    log.info(`${slug}: kept ${prs.length} bad PRs (window ${windowMonths}mo)`);
  }

  // Deterministic order: repo, then PR number.
  all.sort((a, b) => (a.repo === b.repo ? a.prNumber - b.prNumber : a.repo.localeCompare(b.repo)));

  const out: RegressionSourcesFile = {
    fetchedAt: new Date().toISOString(),
    windowMonths: args.windowMonths,
    repos: ALL_REPOS.map((r) => r.slug).filter((s) => args.repos.includes(s)),
    shortRepos,
    prs: all,
  };
  fs.mkdirSync(path.dirname(regressionSourcesFile()), { recursive: true });
  fs.writeFileSync(regressionSourcesFile(), JSON.stringify(out, null, 2) + '\n');
  log.info(
    `wrote ${all.length} bad PRs across ${out.repos.length} repos to ${regressionSourcesFile()}` +
      (shortRepos.length > 0 ? `; ${shortRepos.length} repos below floor` : ''),
  );
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
