// Evidence run for the execution-grounded layer. For each PR in the
// regression and clean corpora, provision the pre/post workspaces and run the
// mutation, issue-repro, and coverage checks, capturing the findings and the
// raw evidence artifacts on disk. Heavy and resumable: a PR whose result.json
// already exists is skipped unless SWARM_EG_FORCE=1.
//
// Knobs (env):
//   SWARM_EG_NODE_BIN          bin dir of the Node the workspaces should use
//   SWARM_EG_REPOS             comma list of repo slugs to include (default all)
//   SWARM_EG_CORPUS            regression | clean | both (default both)
//   SWARM_EG_MAX_PER_REPO      cap PRs per repo (default no cap)
//   SWARM_EG_SHARD             "i/n": process only every n-th selected PR,
//                              offset i (0-based). Lets one repo's PRs run
//                              in parallel across n processes; results are
//                              per-PR files, so shards cannot collide.
//   SWARM_EG_INSTALL_TIMEOUT_MS  per-workspace install cap (default 12 min)
//   SWARM_EG_WALLCLOCK_MS      per-PR wall-clock cap (default 30 min)
//   SWARM_EG_FORCE             re-run PRs that already have a result.json

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runExecutionGrounded, type ExecutionGroundedOutcome } from '../../src/audit/execution-grounded';
import { executionSignalsFromOutcome } from '../../src/audit/execution-grounded/corroborate';
import { getLogger } from '../../src/logger';
import { repoRoot, regressionDir, repoSlug } from './lib/paths';
import { makeOctokit, parseRepo, resolveGithubToken } from './lib/github';

const log = getLogger('eg-run');

interface CorpusPr {
  repo: string;
  prNumber: number;
  headSha: string;
  diffPath: string;
  bodyExcerpt?: string;
}

interface Viability {
  [repoSlug: string]: { status: 'green' | 'yellow' | 'red'; reason?: string };
}

function loadCorpus(file: string): CorpusPr[] {
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { prs: CorpusPr[] };
  return parsed.prs;
}

function loadViability(): Viability {
  const f = path.join(regressionDir(), 'stryker-viability.json');
  if (!fs.existsSync(f)) return {};
  return JSON.parse(fs.readFileSync(f, 'utf8')) as Viability;
}

/** Load the per-repo mutation recipe, if one is committed. Recipes live
 *  beside the corpus because they encode corpus-repo quirks (the nx daemon
 *  hang, a bespoke vitest config), not product behavior. */
function loadRecipe(slug: string): import('../../src/audit/execution-grounded/mutation-check').MutationRecipe | undefined {
  const f = path.join(regressionDir(), 'mutation-recipes', `${slug}.json`);
  if (!fs.existsSync(f)) return undefined;
  return JSON.parse(fs.readFileSync(f, 'utf8')) as import('../../src/audit/execution-grounded/mutation-check').MutationRecipe;
}

function envList(name: string): string[] | undefined {
  const v = process.env[name];
  if (v === undefined || v.trim().length === 0) return undefined;
  return v.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

function summarizeOutcome(outcome: ExecutionGroundedOutcome): unknown {
  return {
    findings: outcome.findings,
    // Per-line execution signals, persisted because the uncovered-survivor
    // findings aggregate per file: trigger calibration and corroboration
    // replay need the exact lines, which finding locations no longer carry.
    signals: executionSignalsFromOutcome(outcome),
    mutationRuns: outcome.mutationRuns.map((r) => ({
      packageDir: r.packageDir,
      ran: r.outcome.ran,
      skipReason: r.outcome.skipReason ?? null,
      summary: r.outcome.summary,
      scope: r.outcome.scope,
      rawReportPath: r.outcome.rawReportPath ?? null,
    })),
    coverageRuns: outcome.coverageRuns.map((r) => ({
      packageDir: r.packageDir,
      ran: r.outcome.ran,
      skipReason: r.outcome.skipReason ?? null,
      uncoveredCount: r.outcome.deltas.filter((d) => !d.coveredAfter).length,
      deltaCount: r.outcome.deltas.length,
      rawReportPath: r.outcome.rawReportPath ?? null,
    })),
    repros: outcome.repros.map((r) => ({
      issue: r.issue,
      verdict: r.verdict,
      preStatus: r.preStatus,
      postStatus: r.postStatus,
    })),
    skipped: outcome.skipped,
  };
}

interface Octokit {
  pulls: { get: (a: { owner: string; repo: string; pull_number: number }) => Promise<{ data: { body?: string | null } }> };
}

async function fetchPrText(octokit: Octokit | null, repo: string, prNumber: number, cacheFile: string, fallback: string): Promise<string> {
  if (fs.existsSync(cacheFile)) return fs.readFileSync(cacheFile, 'utf8');
  if (octokit === null) return fallback;
  try {
    const target = parseRepo(repo);
    const res = await octokit.pulls.get({ owner: target.owner, repo: target.repo, pull_number: prNumber });
    const body = res.data.body ?? fallback;
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, body);
    return body;
  } catch (err) {
    log.debug(`PR body fetch failed for ${repo}#${prNumber}: ${String(err)}`);
    return fallback;
  }
}

async function main(): Promise<void> {
  const root = repoRoot();
  const repoFilter = envList('SWARM_EG_REPOS');
  const corpusSel = process.env.SWARM_EG_CORPUS ?? 'both';
  const maxPerRepo = process.env.SWARM_EG_MAX_PER_REPO !== undefined ? Number(process.env.SWARM_EG_MAX_PER_REPO) : Infinity;
  const installTimeoutMs = Number(process.env.SWARM_EG_INSTALL_TIMEOUT_MS ?? 12 * 60 * 1000);
  const wallClockMs = Number(process.env.SWARM_EG_WALLCLOCK_MS ?? 30 * 60 * 1000);
  const force = process.env.SWARM_EG_FORCE === '1';
  const viability = loadViability();

  let token: string | null = null;
  try {
    token = resolveGithubToken();
  } catch {
    log.warn('no GitHub token; PR bodies/issues use the stored excerpt and unauthenticated API');
  }
  const octokit = (token !== null ? makeOctokit(token) : null) as Octokit | null;

  const shardSpec = process.env.SWARM_EG_SHARD;
  let shardIndex = 0;
  let shardCount = 1;
  if (shardSpec !== undefined && shardSpec.trim().length > 0) {
    const m = shardSpec.match(/^(\d+)\/(\d+)$/);
    if (m === null || Number(m[2]) < 1 || Number(m[1]) >= Number(m[2])) {
      log.error(`SWARM_EG_SHARD must be "i/n" with 0 <= i < n (got: ${shardSpec})`);
      process.exitCode = 1;
      return;
    }
    shardIndex = Number(m[1]);
    shardCount = Number(m[2]);
  }

  const corpora: Array<{ name: 'regression' | 'clean'; prs: CorpusPr[]; outBase: string }> = [];
  if (corpusSel === 'both' || corpusSel === 'regression') {
    corpora.push({
      name: 'regression',
      prs: loadCorpus(path.join(regressionDir(), 'sources.json')),
      outBase: path.join(regressionDir(), 'execution-grounded'),
    });
  }
  if (corpusSel === 'both' || corpusSel === 'clean') {
    corpora.push({
      name: 'clean',
      prs: loadCorpus(path.join(root, 'benchmarks', 'real-prs', 'sources-v2.json')),
      outBase: path.join(root, 'benchmarks', 'real-prs', 'execution-grounded-clean'),
    });
  }

  const scratch = path.join(os.tmpdir(), 'swarm-eg-run');
  const cacheDir = path.join(scratch, '.pm-cache');
  fs.mkdirSync(scratch, { recursive: true });
  const timeLedger: Array<{ corpus: string; repo: string; pr: number; ms: number; findings: number; skipped: number }> = [];

  for (const corpus of corpora) {
    const perRepoCount = new Map<string, number>();
    let selectedIdx = -1;
    for (const pr of corpus.prs) {
      const slug = repoSlug(pr.repo);
      if (repoFilter !== undefined && !repoFilter.includes(pr.repo) && !repoFilter.includes(slug)) continue;
      if (viability[slug]?.status === 'red') continue;
      selectedIdx += 1;
      if (selectedIdx % shardCount !== shardIndex) continue;
      const n = perRepoCount.get(slug) ?? 0;
      if (n >= maxPerRepo) continue;
      perRepoCount.set(slug, n + 1);

      const outDir = path.join(corpus.outBase, slug, String(pr.prNumber));
      const resultFile = path.join(outDir, 'result.json');
      if (fs.existsSync(resultFile) && !force) {
        log.info(`skip (done): ${corpus.name} ${pr.repo}#${pr.prNumber}`);
        continue;
      }
      // Diffs live under each corpus's own base dir: the regression corpus at
      // benchmarks/regression-corpus/, the clean corpus at benchmarks/real-prs/.
      // A diffPath like "diffs/<slug>/<pr>.diff" is relative to that base, so it
      // must resolve against the corpus base, not always the regression dir.
      const corpusBase =
        corpus.name === 'regression' ? regressionDir() : path.join(root, 'benchmarks', 'real-prs');
      const diffFile = path.join(corpusBase, pr.diffPath);
      const altDiff = path.join(corpusBase, 'diffs', slug, `${pr.prNumber}.diff`);
      const diffPath = fs.existsSync(diffFile) ? diffFile : altDiff;
      if (!fs.existsSync(diffPath)) {
        log.warn(`no stored diff for ${pr.repo}#${pr.prNumber} (${diffPath}); skipping`);
        continue;
      }
      const prDiff = fs.readFileSync(diffPath, 'utf8');
      fs.mkdirSync(outDir, { recursive: true });
      const prText = await fetchPrText(octokit, pr.repo, pr.prNumber, path.join(outDir, 'pr-body.txt'), pr.bodyExcerpt ?? '');

      const recipe = loadRecipe(slug);
      if (recipe !== undefined) log.info(`mutation recipe applied for ${slug}`);
      log.info(`run: ${corpus.name} ${pr.repo}#${pr.prNumber}`);
      const started = Date.now();
      let outcome: ExecutionGroundedOutcome;
      try {
        outcome = await runExecutionGrounded({
          prDiff,
          repo: pr.repo,
          prNumber: pr.prNumber,
          prHeadSha: pr.headSha,
          prText,
          config: {
            enabled: true,
            mutation: true,
            issueRepro: true,
            coverage: true,
            maxWallClockPerPrMs: wallClockMs,
            runner: process.env.SWARM_EG_RUNNER === 'docker' ? 'docker' : 'host',
            corroborateStructural: false,
          },
          baseDir: scratch,
          cacheDir,
          evidenceDir: outDir,
          issueCacheDir: path.join(regressionDir(), 'issue-cache'),
          ...(recipe !== undefined ? { mutationRecipe: recipe } : {}),
          ...(token !== null ? { githubToken: token } : {}),
          installTimeoutMs,
          runBuild: true,
        });
      } catch (err) {
        log.warn(`run failed for ${pr.repo}#${pr.prNumber}: ${String(err)}`);
        outcome = { findings: [], mutationRuns: [], coverageRuns: [], repros: [], restorations: [], mockRestorations: [], noOpRestorations: [], typeSuppressionRestorations: [], fakeRefactorRestorations: [], deadBranchRestorations: [], skipped: [`error: ${String(err)}`] };
      }
      const ms = Date.now() - started;
      const record = {
        corpus: corpus.name,
        repo: pr.repo,
        prNumber: pr.prNumber,
        headSha: pr.headSha,
        viability: viability[slug]?.status ?? 'unknown',
        wallClockMs: ms,
        ...(summarizeOutcome(outcome) as object),
      };
      fs.writeFileSync(resultFile, JSON.stringify(record, null, 2));
      timeLedger.push({ corpus: corpus.name, repo: pr.repo, pr: pr.prNumber, ms, findings: outcome.findings.length, skipped: outcome.skipped.length });
      log.info(`done ${pr.repo}#${pr.prNumber}: ${outcome.findings.length} findings, ${(ms / 1000).toFixed(0)}s`);
    }
  }

  const timeLedgerFile = path.join(regressionDir(), 'execution-grounded', 'time-ledger.json');
  fs.mkdirSync(path.dirname(timeLedgerFile), { recursive: true });
  fs.writeFileSync(timeLedgerFile, JSON.stringify({ generatedAt: new Date().toISOString(), runs: timeLedger }, null, 2));
  log.info(`evidence run complete: ${timeLedger.length} PRs processed this pass`);
}

main().catch((err) => {
  log.error(String(err));
  process.exitCode = 1;
});
