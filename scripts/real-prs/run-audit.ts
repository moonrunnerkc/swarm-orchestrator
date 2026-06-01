// Audit every PR in the corpus with both the current (post-upgrade)
// pipeline and the frozen pre-upgrade auditor, and write the two finding
// lists side by side. Post runs the library directly (judge enabled,
// judge-primary advisory per the shipped default). Pre shells out to the
// built pre-upgrade CLI; when that build is unavailable the pre side is
// recorded as null, never faked.
//
// Usage:
//   node dist/scripts/real-prs/run-audit.js [--no-pre] [--no-judge] [--limit N]

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { runCheatDetectors } from '../../src/audit/cheat-detector';
import type { AuditInput, Finding } from '../../src/audit/types';
import { ensurePreUpgradeCli } from './build-pre-upgrade';
import { normalizeFindings } from './lib/findings';
import { auditResultsDir, realPrsDir, repoSlug, sourcesFile } from './lib/paths';
import type { AuditResultRecord, SourcesFile } from './lib/types';

const log = getLogger('real-prs:audit');

interface Args {
  noPre: boolean;
  noJudge: boolean;
  limit: number | null;
}

function parseArgs(argv: string[]): Args {
  let noPre = false;
  let noJudge = false;
  let limit: number | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--no-pre') noPre = true;
    else if (a === '--no-judge') noJudge = true;
    else if (a === '--limit' && argv[i + 1] !== undefined) {
      limit = Number(argv[i + 1]);
      i += 1;
    }
  }
  return { noPre, noJudge, limit };
}

interface PrLike {
  number: number;
  headSha: string;
  title: string;
  body: string;
  author: string;
  repository: string;
}

async function runPost(diff: string, repoRootDir: string, pr: PrLike, judge: boolean): Promise<Finding[]> {
  const input: AuditInput = {
    unifiedDiff: diff,
    repoRoot: repoRootDir,
    judgeEnabled: judge,
    pr: {
      number: pr.number,
      headSha: pr.headSha,
      baseSha: '',
      title: pr.title,
      body: pr.body,
      author: pr.author,
      headRef: '',
      repository: pr.repository,
    },
  };
  const result = await runCheatDetectors(input);
  return result.findings;
}

interface PreOutput {
  findings?: Finding[];
}

function runPre(preCli: string, diffPath: string, judge: boolean): Finding[] | null {
  const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-pre-run-'));
  const tmpLedger = path.join(tmpCwd, 'ledger.jsonl');
  try {
    const cliArgs = [preCli, 'audit', '--diff-file', diffPath, '--output', 'json', '--ledger-path', tmpLedger];
    if (judge) cliArgs.push('--enable-llm-judge');
    const stdout = execFileSync('node', cliArgs, {
      cwd: tmpCwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as PreOutput;
    return parsed.findings ?? [];
  } catch (err) {
    log.warn(`pre-upgrade audit failed on ${diffPath}: ${(err as Error).message}`);
    return null;
  } finally {
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  loadDotenv();
  const args = parseArgs(process.argv.slice(2));
  const srcFile = sourcesFile();
  if (!fs.existsSync(srcFile)) {
    log.error(`no sources.json at ${srcFile}; run real-prs:fetch first`);
    process.exit(1);
  }
  const sources = JSON.parse(fs.readFileSync(srcFile, 'utf8')) as SourcesFile;
  const prs = args.limit !== null ? sources.prs.slice(0, args.limit) : sources.prs;

  let preCli: string | null = null;
  if (!args.noPre) {
    preCli = ensurePreUpgradeCli();
    if (preCli === null) {
      log.warn('pre-upgrade build unavailable; recording pre side as null for all PRs');
    }
  }

  const repoRootDir = realPrsDir();
  const outDir = auditResultsDir();
  let done = 0;
  for (const pr of prs) {
    const absDiff = path.join(realPrsDir(), pr.diffPath);
    if (!fs.existsSync(absDiff)) {
      log.warn(`missing diff for ${pr.repo}#${pr.prNumber} at ${absDiff}; skipping`);
      continue;
    }
    const diff = fs.readFileSync(absDiff, 'utf8');
    const prLike: PrLike = {
      number: pr.prNumber,
      headSha: pr.headSha,
      title: pr.title,
      body: pr.bodyExcerpt,
      author: '',
      repository: pr.repo,
    };
    const postRaw = await runPost(diff, repoRootDir, prLike, !args.noJudge);
    const post = normalizeFindings(pr.repo, pr.prNumber, postRaw);
    const preRaw = preCli !== null ? runPre(preCli, absDiff, !args.noJudge) : null;
    const pre = preRaw === null ? null : normalizeFindings(pr.repo, pr.prNumber, preRaw);

    const record: AuditResultRecord = {
      repo: pr.repo,
      prNumber: pr.prNumber,
      headSha: pr.headSha,
      pre,
      post,
    };
    const repoOut = path.join(outDir, repoSlug(pr.repo));
    fs.mkdirSync(repoOut, { recursive: true });
    fs.writeFileSync(path.join(repoOut, `${pr.prNumber}.json`), JSON.stringify(record, null, 2) + '\n');
    done += 1;
    log.info(
      `${pr.repo}#${pr.prNumber}: post=${post.length} pre=${pre === null ? 'n/a' : pre.length} (${done}/${prs.length})`,
    );
  }
  log.info(`wrote ${done} audit records to ${outDir}`);
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
