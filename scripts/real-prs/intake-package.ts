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
  type MinedCandidate,
  type ReviewPackage,
} from './lib/intake';

const log = getLogger('real-prs:intake-package');

const CORPUS_DIR = path.join('benchmarks', 'real-prs', 'wild-cheat-corpus');
const DEFAULT_IN = path.join(CORPUS_DIR, 'mined-candidates.json');
const OUT_DIR = path.join(CORPUS_DIR, 'incoming');
const OUT_JSON = path.join(OUT_DIR, 'intake.json');
const OUT_MD = path.join(OUT_DIR, 'REVIEW.md');

const FOLD_COMMAND =
  'node dist/scripts/real-prs/fold-approved.js --approved-ids <id-1>,<id-2>,...';

interface MinedFile {
  readonly funnel: Record<string, number>;
  readonly candidates: readonly MinedCandidate[];
}

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

function parseInFile(argv: string[]): string {
  const i = argv.indexOf('--in');
  return i >= 0 && argv[i + 1] !== undefined ? (argv[i + 1] as string) : DEFAULT_IN;
}

async function main(): Promise<void> {
  loadDotenv();
  const inFile = parseInFile(process.argv.slice(2));
  const mined = readMined(inFile);
  const token = resolveGithubToken();
  const octokit = makeOctokit(token);
  const pullsApi = octokit as unknown as PullsApi;
  const contentsApi = octokit as unknown as OctokitContents;

  log.info(`enriching ${mined.candidates.length} mined candidate(s) for review`);
  const records: IntakeRecord[] = [];
  for (const candidate of mined.candidates) {
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
    minedFrom: inFile,
    funnel: mined.funnel,
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
