// Package complaint-mined candidates for maintainer review. Reads the miner's
// output, enriches each candidate with the intake metadata a review needs
// (head/base SHA, PR state, a static EG-viability screen, a content-addressed
// evidence id), and writes the review package (intake.json + REVIEW.md) under
// benchmarks/real-prs/wild-cheat-corpus/incoming/. Nothing is folded: the fold
// is fold-approved.ts, run by a maintainer on an explicit approved-ids list.
//
// Bounded: one pulls.get + one contents listing (plus one package.json fetch)
// per candidate, all on the 5000/hr core API. No arbiter, no clone, no install.
//
// Usage:
//   node dist/scripts/real-prs/intake-package.js [--in <mined-candidates.json>]

import * as fs from 'fs';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { makeOctokit, parseRepo, resolveGithubToken, withRetry } from './lib/github';
import { screenPr, type OctokitContents } from './eg-viability-screen';
import {
  buildIntakeRecord,
  renderReviewMarkdown,
  summarizeReview,
  type IntakeRecord,
  type ReviewPackage,
} from './lib/intake';
import { candidateKey, mergeMinedCandidates, type MinedFile } from './lib/intake-merge';

const log = getLogger('real-prs:intake-package');

const CORPUS_DIR = path.join('benchmarks', 'real-prs', 'wild-cheat-corpus');
const DEFAULT_IN = path.join(CORPUS_DIR, 'mined-candidates.json');
const OUT_DIR = path.join(CORPUS_DIR, 'incoming');
const OUT_JSON = path.join(OUT_DIR, 'intake.json');
const OUT_MD = path.join(OUT_DIR, 'REVIEW.md');

const FOLD_COMMAND =
  'node dist/scripts/real-prs/fold-approved.js --approved-ids <id-1>,<id-2>,...';

interface PullState {
  readonly headSha: string;
  readonly baseSha: string;
  readonly state: 'merged' | 'closed' | 'open';
}

interface PullsApi {
  pulls: {
    get(p: { owner: string; repo: string; pull_number: number }): Promise<{
      data: { head: { sha: string }; base: { sha: string }; merged_at: string | null; state: string };
    }>;
  };
}

async function fetchPullState(octokit: PullsApi, repo: string, prNumber: number): Promise<PullState> {
  const target = parseRepo(repo);
  const res = await withRetry(
    () => octokit.pulls.get({ owner: target.owner, repo: target.repo, pull_number: prNumber }),
    `pulls.get ${repo}#${prNumber}`,
  );
  const d = res.data;
  const state: PullState['state'] =
    d.merged_at !== null ? 'merged' : d.state === 'closed' ? 'closed' : 'open';
  return { headSha: d.head.sha, baseSha: d.base.sha, state };
}

function readMined(file: string): MinedFile {
  if (!fs.existsSync(file)) {
    throw new Error(`mined candidates not found at ${file}; run mine-complaints first`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as MinedFile;
}

/** Every `--in <file>` in order; defaults to the endgame mine when none given. */
function parseInFiles(argv: string[]): string[] {
  const files: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--in' && argv[i + 1] !== undefined) {
      files.push(argv[i + 1] as string);
      i += 1;
    }
  }
  return files.length > 0 ? files : [DEFAULT_IN];
}

/** PR-identity keys (repo#number) already frozen in the corpus (highest version),
 *  read directly for dedup so the package never re-offers an entry the maintainer
 *  already folded. Reads only ids, not held-out cheat content, so it is not a
 *  held-out evaluation read. Keys on repo#number because corpus ids are
 *  vendor-prefixed and miner ids are not. */
function loadCorpusKeys(): Set<string> {
  const keys = new Set<string>();
  if (!fs.existsSync(CORPUS_DIR)) return keys;
  const versions = fs
    .readdirSync(CORPUS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^v\d+$/.test(e.name))
    .map((e) => e.name);
  if (versions.length === 0) return keys;
  const latest = versions.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).at(-1) as string;
  const file = path.join(CORPUS_DIR, latest, 'dataset.json');
  if (!fs.existsSync(file)) return keys;
  const ds = JSON.parse(fs.readFileSync(file, 'utf8')) as { entries?: Array<{ repo: string; prNumber: number }> };
  for (const e of ds.entries ?? []) keys.add(candidateKey(e.repo, e.prNumber));
  return keys;
}

async function main(): Promise<void> {
  loadDotenv();
  const inFiles = parseInFiles(process.argv.slice(2));
  const corpusKeys = loadCorpusKeys();
  const merged = mergeMinedCandidates(inFiles.map(readMined), corpusKeys);
  const token = resolveGithubToken();
  const octokit = makeOctokit(token);
  const pullsApi = octokit as unknown as PullsApi;
  const contentsApi = octokit as unknown as OctokitContents;

  log.info(
    `merged ${merged.candidates.length} candidate(s) from ${inFiles.length} input(s); ` +
      `dropped ${merged.droppedInCorpus} already in corpus, ${merged.droppedDuplicate} duplicate`,
  );
  const records: IntakeRecord[] = [];
  for (const candidate of merged.candidates) {
    let pull: PullState;
    try {
      pull = await fetchPullState(pullsApi, candidate.repo, candidate.prNumber);
    } catch (err) {
      log.warn(`skip ${candidate.id}: pulls.get failed: ${String(err)}`);
      continue;
    }
    const viability = await screenPr(contentsApi, {
      id: candidate.id,
      repo: candidate.repo,
      headSha: pull.headSha,
      outcome: 'unknown',
    });
    const record = buildIntakeRecord(candidate, pull.state, pull, viability);
    records.push(record);
    log.info(
      `  + ${record.id} [${record.reviewBucket}] egViable=${record.egViable} (${record.egViabilityReason})`,
    );
  }

  const pkg: ReviewPackage = {
    generatedBy: 'scripts/real-prs/intake-package.ts',
    minedFrom: inFiles.join(', '),
    funnel: merged.funnel,
    counts: summarizeReview(records),
    records,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(pkg, null, 2) + '\n');
  fs.writeFileSync(OUT_MD, renderReviewMarkdown(pkg, FOLD_COMMAND));
  log.info(
    `intake-package: ${records.length} record(s) (${pkg.counts.arbiterConfirmed} confirmed, ` +
      `${pkg.counts.arbiterSplit} split, ${pkg.counts.egViable} EG-viable) -> ${OUT_JSON}, ${OUT_MD}`,
  );
}

if (require.main === module) {
  main().catch((err: unknown) => {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  });
}
