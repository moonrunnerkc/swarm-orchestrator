// Audit both corpora with the pre-upgrade and post-upgrade pipelines.
// Post runs the library directly with the judge enabled (Haiku, the
// pinned judge model); pre shells out to the frozen pre-upgrade CLI built
// from the last pre-oracle tag. Each finding is recorded with full
// provenance (detector, judge path, severity, line range, rationale).
// A judge-call counter is threaded through so the cost ledger can price
// the audit's judge calls at the documented per-call estimate; cache hits
// are free and counted separately. Resumable: a PR whose record exists is
// skipped unless --force.
//
// Usage:
//   node dist/scripts/real-prs/run-audit-v2.js \
//     [--corpus regression|clean|both] [--no-pre] [--no-judge] [--limit N] [--force]

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { runCheatDetectors } from '../../src/audit/cheat-detector';
import type { AuditInput, Finding, JudgeLedgerEntry, JudgeLedgerSink } from '../../src/audit/types';
import { ensurePreUpgradeCli } from './build-pre-upgrade';
import { normalizeFindings } from './lib/findings';
import {
  auditResultsV2Dir,
  realPrsDir,
  regressionAuditResultsDir,
  regressionDir,
  regressionSourcesFile,
  repoSlug,
  sourcesV2File,
} from './lib/paths';
import type { AuditResultRecord, RegressionSourcesFile, SourcesFile } from './lib/types';

const log = getLogger('real-prs:audit-v2');

type Corpus = 'regression' | 'clean';

interface Args {
  corpus: Corpus | 'both';
  noPre: boolean;
  noJudge: boolean;
  limit: number | null;
  force: boolean;
  shardIndex: number;
  shardCount: number;
}

function parseArgs(argv: string[]): Args {
  let corpus: Args['corpus'] = 'both';
  let noPre = false;
  let noJudge = false;
  let limit: number | null = null;
  let force = false;
  let shardIndex = 0;
  let shardCount = 1;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--corpus' && (next === 'regression' || next === 'clean' || next === 'both')) (corpus = next), (i += 1);
    else if (a === '--no-pre') noPre = true;
    else if (a === '--no-judge') noJudge = true;
    else if (a === '--force') force = true;
    else if (a === '--limit' && next !== undefined) (limit = Number(next)), (i += 1);
    // --shard i/N runs only PRs whose index mod N === i, so N processes can
    // audit disjoint slices in parallel against a batching judge server.
    else if (a === '--shard' && next !== undefined) {
      const m = /^(\d+)\/(\d+)$/.exec(next);
      if (m !== null) (shardIndex = Number(m[1])), (shardCount = Number(m[2]));
      i += 1;
    }
  }
  return { corpus, noPre, noJudge, limit, force, shardIndex, shardCount };
}

/** Counts judge calls so the cost ledger can price them. Live calls are
 *  the billable ones; cache hits are free replays. */
class JudgeCounter implements JudgeLedgerSink {
  liveCalls = 0;
  cacheHits = 0;
  appendJudgeEntry(entry: JudgeLedgerEntry): void {
    if (entry.cacheHit) this.cacheHits += 1;
    else if (entry.answer !== 'unavailable') this.liveCalls += 1;
  }
}

interface CorpusPr {
  repo: string;
  prNumber: number;
  headSha: string;
  title: string;
  body: string;
  diffPath: string;
}

function loadCorpus(corpus: Corpus): CorpusPr[] {
  if (corpus === 'regression') {
    if (!fs.existsSync(regressionSourcesFile())) return [];
    const s = JSON.parse(fs.readFileSync(regressionSourcesFile(), 'utf8')) as RegressionSourcesFile;
    return s.prs.map((p) => ({
      repo: p.repo,
      prNumber: p.prNumber,
      headSha: p.headSha,
      title: p.title,
      body: p.bodyExcerpt,
      diffPath: p.diffPath,
    }));
  }
  if (!fs.existsSync(sourcesV2File())) return [];
  const s = JSON.parse(fs.readFileSync(sourcesV2File(), 'utf8')) as SourcesFile;
  return s.prs.map((p) => ({
    repo: p.repo,
    prNumber: p.prNumber,
    headSha: p.headSha,
    title: p.title,
    body: p.bodyExcerpt,
    diffPath: p.diffPath,
  }));
}

function baseDir(corpus: Corpus): string {
  return corpus === 'regression' ? regressionDir() : realPrsDir();
}

function outDir(corpus: Corpus): string {
  return corpus === 'regression' ? regressionAuditResultsDir() : auditResultsV2Dir();
}

async function runPost(
  diff: string,
  repoRootDir: string,
  pr: CorpusPr,
  judge: boolean,
  counter: JudgeCounter,
): Promise<Finding[]> {
  const input: AuditInput = {
    unifiedDiff: diff,
    repoRoot: repoRootDir,
    judgeEnabled: judge,
    judgeLedger: counter,
    pr: {
      number: pr.prNumber,
      headSha: pr.headSha,
      baseSha: '',
      title: pr.title,
      body: pr.body,
      author: '',
      headRef: '',
      repository: pr.repo,
    },
  };
  const result = await runCheatDetectors(input);
  return result.findings;
}

function runPre(preCli: string, diffPath: string, judge: boolean): Finding[] | null {
  const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-pre-v2-'));
  const tmpLedger = path.join(tmpCwd, 'ledger.jsonl');
  try {
    const cliArgs = [preCli, 'audit', '--diff-file', diffPath, '--output', 'json', '--ledger-path', tmpLedger];
    if (judge) cliArgs.push('--enable-llm-judge');
    const stdout = execFileSync('node', cliArgs, { cwd: tmpCwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const parsed = JSON.parse(stdout) as { findings?: Finding[] };
    return parsed.findings ?? [];
  } catch (err) {
    log.warn(`pre-upgrade audit failed on ${diffPath}: ${(err as Error).message}`);
    return null;
  } finally {
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  }
}

async function processCorpus(
  corpus: Corpus,
  args: Args,
  preCli: string | null,
  counter: JudgeCounter,
): Promise<void> {
  const allPrs = loadCorpus(corpus);
  const prs =
    args.shardCount > 1 ? allPrs.filter((_, i) => i % args.shardCount === args.shardIndex) : allPrs;
  if (prs.length === 0) {
    log.warn(`${corpus} corpus empty; skipping`);
    return;
  }
  const base = baseDir(corpus);
  const repoRootDir = base;
  const out = outDir(corpus);
  let done = 0;
  for (const pr of prs) {
    if (args.limit !== null && done >= args.limit) break;
    const repoOut = path.join(out, repoSlug(pr.repo));
    const recFile = path.join(repoOut, `${pr.prNumber}.json`);
    if (!args.force && fs.existsSync(recFile)) {
      done += 1;
      continue;
    }
    const absDiff = path.join(base, pr.diffPath);
    if (!fs.existsSync(absDiff)) {
      log.warn(`missing diff for ${pr.repo}#${pr.prNumber} at ${absDiff}; skipping`);
      continue;
    }
    const diff = fs.readFileSync(absDiff, 'utf8');
    const postRaw = await runPost(diff, repoRootDir, pr, !args.noJudge, counter);
    const post = normalizeFindings(pr.repo, pr.prNumber, postRaw);
    // The frozen pre-upgrade CLI only knows the Anthropic judge; with the
    // post judge pointed at a local server (or no credentials), the pre
    // judge would only make dead calls, so pre runs structural-only then.
    const preJudge = !args.noJudge && (process.env.SWARM_JUDGE_PROVIDER ?? '').toLowerCase() !== 'local';
    const preRaw = preCli !== null ? runPre(preCli, absDiff, preJudge) : null;
    const pre = preRaw === null ? null : normalizeFindings(pr.repo, pr.prNumber, preRaw);
    const record: AuditResultRecord = { repo: pr.repo, prNumber: pr.prNumber, headSha: pr.headSha, pre, post };
    fs.mkdirSync(repoOut, { recursive: true });
    fs.writeFileSync(recFile, JSON.stringify(record, null, 2) + '\n');
    done += 1;
    log.info(
      `${corpus} ${pr.repo}#${pr.prNumber}: post=${post.length} pre=${pre === null ? 'n/a' : pre.length} ` +
        `(${done}/${prs.length}) judge live=${counter.liveCalls} cache=${counter.cacheHits}`,
    );
  }
}

async function main(): Promise<void> {
  loadDotenv();
  const args = parseArgs(process.argv.slice(2));

  let preCli: string | null = null;
  if (!args.noPre) {
    preCli = ensurePreUpgradeCli();
    if (preCli === null) log.warn('pre-upgrade build unavailable; recording pre side as null');
  }

  const counter = new JudgeCounter();
  const corpora: Corpus[] = args.corpus === 'both' ? ['regression', 'clean'] : [args.corpus];
  for (const corpus of corpora) {
    await processCorpus(corpus, args, preCli, counter);
  }

  // Sidecar for the cost ledger: the audit's billable judge calls. The
  // model reflects the provider actually used; a local judge is free.
  const judgeModel =
    (process.env.SWARM_JUDGE_PROVIDER ?? '').toLowerCase() === 'local'
      ? `local:${process.env.SWARM_JUDGE_MODEL ?? process.env.RAPIDMLX_MODEL ?? 'local-model'}`
      : 'claude-haiku-4-5';
  const costSidecar = path.join(realPrsDir(), 'audit-cost.json');
  fs.writeFileSync(
    costSidecar,
    JSON.stringify({ judgeModel, liveJudgeCalls: counter.liveCalls, judgeCacheHits: counter.cacheHits }, null, 2) + '\n',
  );
  log.info(`audit-v2 complete; billable judge calls=${counter.liveCalls}, cache hits=${counter.cacheHits}`);
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
