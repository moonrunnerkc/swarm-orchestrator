// Run the off-the-shelf analyzers (Semgrep, ESLint security rules) over
// both corpora so the report can show what class of review failure the
// auditor catches that they do not. For each PR we materialize the
// changed source files at the head SHA, run each tool, restrict the
// findings to PR-introduced lines, and write one file per (tool, repo,
// pr). Resumable: a PR whose output already exists is skipped.
//
// Usage:
//   node dist/scripts/real-prs/run-differential.js \
//     [--corpus regression|clean|both] [--limit N]

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { resolveGithubToken } from './lib/github';
import {
  eslintRunnerPaths,
  eslintRunnerReady,
  materializeChangedFiles,
  resolveSemgrepBin,
  runEslint,
  runSemgrep,
} from './lib/differential';
import {
  differentialDir,
  realPrsDir,
  regressionDir,
  regressionSourcesFile,
  repoSlug,
  sourcesV2File,
} from './lib/paths';
import type { DifferentialFinding, RegressionSourcesFile, SourcesFile } from './lib/types';

const log = getLogger('real-prs:differential');

interface Args {
  corpus: 'regression' | 'clean' | 'both';
  limit: number | null;
}

function parseArgs(argv: string[]): Args {
  let corpus: Args['corpus'] = 'both';
  let limit: number | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--corpus' && (next === 'regression' || next === 'clean' || next === 'both')) {
      corpus = next;
      i += 1;
    } else if (a === '--limit' && next !== undefined) {
      limit = Number(next);
      i += 1;
    }
  }
  return { corpus, limit };
}

interface CorpusPr {
  repo: string;
  prNumber: number;
  headSha: string;
  diffPath: string;
}

function loadRegression(): CorpusPr[] {
  if (!fs.existsSync(regressionSourcesFile())) return [];
  const s = JSON.parse(fs.readFileSync(regressionSourcesFile(), 'utf8')) as RegressionSourcesFile;
  return s.prs.map((p) => ({ repo: p.repo, prNumber: p.prNumber, headSha: p.headSha, diffPath: p.diffPath }));
}

function loadClean(): CorpusPr[] {
  if (!fs.existsSync(sourcesV2File())) return [];
  const s = JSON.parse(fs.readFileSync(sourcesV2File(), 'utf8')) as SourcesFile;
  return s.prs.map((p) => ({ repo: p.repo, prNumber: p.prNumber, headSha: p.headSha, diffPath: p.diffPath }));
}

/** Differential output root per corpus. Regression lives under the
 *  regression corpus; clean lives beside the v2 clean corpus. */
function diffOutDir(corpus: 'regression' | 'clean'): string {
  return corpus === 'regression' ? differentialDir() : path.join(realPrsDir(), 'differential-v2');
}

function diffBaseDir(corpus: 'regression' | 'clean'): string {
  return corpus === 'regression' ? regressionDir() : realPrsDir();
}

function outFileFor(corpus: 'regression' | 'clean', tool: string, repo: string, pr: number): string {
  return path.join(diffOutDir(corpus), tool, repoSlug(repo), `${pr}.json`);
}

function ensureEslintRunner(): boolean {
  if (eslintRunnerReady()) return true;
  const { dir } = eslintRunnerPaths();
  log.info(`installing the isolated ESLint differential toolchain in ${dir} ...`);
  try {
    execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit' });
    return eslintRunnerReady();
  } catch (err) {
    log.warn(`could not install the ESLint runner: ${(err as Error).message}`);
    return false;
  }
}

function writeFindings(file: string, tool: string, findings: DifferentialFinding[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ tool, findings }, null, 2) + '\n');
}

async function processCorpus(
  corpus: 'regression' | 'clean',
  prs: CorpusPr[],
  token: string,
  semgrepBin: string | null,
  eslintReady: boolean,
  limit: number | null,
): Promise<void> {
  const base = diffBaseDir(corpus);
  let done = 0;
  for (const pr of prs) {
    if (limit !== null && done >= limit) break;
    const semOut = outFileFor(corpus, 'semgrep', pr.repo, pr.prNumber);
    const eslOut = outFileFor(corpus, 'eslint-security', pr.repo, pr.prNumber);
    const needSem = semgrepBin !== null && !fs.existsSync(semOut);
    const needEsl = eslintReady && !fs.existsSync(eslOut);
    if (!needSem && !needEsl) {
      done += 1;
      continue;
    }
    const absDiff = path.join(base, pr.diffPath);
    if (!fs.existsSync(absDiff)) {
      log.warn(`missing diff for ${pr.repo}#${pr.prNumber} at ${absDiff}; skipping`);
      continue;
    }
    const diff = fs.readFileSync(absDiff, 'utf8');
    let mat;
    try {
      mat = await materializeChangedFiles(token, pr.repo, pr.headSha, diff);
    } catch (err) {
      log.warn(`materialize failed for ${pr.repo}#${pr.prNumber}: ${(err as Error).message}`);
      continue;
    }
    try {
      if (needSem && semgrepBin !== null) {
        writeFindings(semOut, 'semgrep', runSemgrep(mat, semgrepBin));
      }
      if (needEsl) {
        writeFindings(eslOut, 'eslint-security', runEslint(mat));
      }
    } finally {
      mat.cleanup();
    }
    done += 1;
    log.info(`${corpus} ${pr.repo}#${pr.prNumber}: differential done (${done}/${prs.length})`);
  }
}

async function main(): Promise<void> {
  loadDotenv();
  const args = parseArgs(process.argv.slice(2));
  const token = resolveGithubToken();

  const semgrepBin = resolveSemgrepBin();
  if (semgrepBin === null) {
    log.warn('semgrep not found on PATH or common install locations; semgrep side will be skipped');
  } else {
    log.info(`semgrep: ${semgrepBin}`);
  }
  const eslintReady = ensureEslintRunner();
  if (!eslintReady) log.warn('ESLint differential toolchain unavailable; eslint side will be skipped');
  if (semgrepBin === null && !eslintReady) {
    log.error('no external analyzer available; install semgrep or the ESLint runner and retry');
    process.exit(1);
  }

  const corpora: Array<'regression' | 'clean'> =
    args.corpus === 'both' ? ['regression', 'clean'] : [args.corpus];
  for (const corpus of corpora) {
    const prs = corpus === 'regression' ? loadRegression() : loadClean();
    if (prs.length === 0) {
      log.warn(`${corpus} corpus is empty; skipping`);
      continue;
    }
    log.info(`running differential on ${prs.length} ${corpus} PRs`);
    await processCorpus(corpus, prs, token, semgrepBin, eslintReady, args.limit);
  }
  log.info('differential complete');
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
