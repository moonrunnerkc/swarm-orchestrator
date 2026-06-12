// The bounded execution-grounded measurement over the EG-viable slice of the
// outcome-labeled real corpus (the 12 PRs eg-viability.json marks provisionable).
// For each viable PR it runs the full execution-grounded layer (mutation,
// coverage, the proof tier) in a sandbox and records the runtime-corroborated
// findings, so the corroborated promotion tier in promotions.json can move from
// `viability-screened` to a measured precision once the run has covered the
// slice.
//
// Single-target by design: `--repo <slug>` or `--only <id>` runs exactly one
// repo, so a workflow-dispatch CI matrix can fan the 12 repos across 12
// containers, each with its own time cap, and the per-PR artifacts are folded
// into promotions.json afterward by the existing promotions scripts. Run with no
// target it walks the whole slice (a local sweep is intentionally not the
// default path; the matrix is).
//
// Usage:
//   node dist/scripts/real-prs/eg-viable-measure.js --only <id>
//   node dist/scripts/real-prs/eg-viable-measure.js --repo <owner/repo>
//   node dist/scripts/real-prs/eg-viable-measure.js --aggregate
//
// Env: SWARM_EG_NODE_BIN, SWARM_EG_INSTALL_TIMEOUT_MS, SWARM_EG_WALLCLOCK_MS.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runCheatDetectors } from '../../src/audit/cheat-detector';
import { runExecutionGrounded } from '../../src/audit/execution-grounded';
import type { ExecutionGroundedConfig } from '../../src/audit/cheat-detector/audit-config';
import { getLogger } from '../../src/logger';

const log = getLogger('real-prs:eg-viable');

const CORPUS_DIR = path.join('benchmarks', 'real-corpus');
const RAW_DIR = path.join(CORPUS_DIR, 'raw');
const VIABILITY_FILE = path.join(CORPUS_DIR, 'eg-viability.json');
const RESULTS_DIR = path.join(CORPUS_DIR, 'eg-viable-results');
const AGGREGATE_FILE = path.join(CORPUS_DIR, 'eg-viable-corroborated.json');

interface ViabilityRecord {
  id: string;
  repo: string;
  headSha: string;
  outcome: string;
}
interface ViabilityFile {
  viableIds: string[];
  records: ViabilityRecord[];
}
interface RawPr {
  pr: { number?: number; headSha: string; baseSha?: string; title?: string; body?: string; repository: string };
}

interface Args {
  only: string | null;
  repo: string | null;
  aggregate: boolean;
}
function parseArgs(argv: string[]): Args {
  let only: string | null = null;
  let repo: string | null = null;
  let aggregate = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--only' && next !== undefined) (only = next), (i += 1);
    else if (a === '--repo' && next !== undefined) (repo = next), (i += 1);
    else if (a === '--aggregate') aggregate = true;
  }
  return { only, repo, aggregate };
}

/** Recursively locate `<id>.json` under RAW_DIR (the raw tree nests negatives). */
function findRawFile(dir: string, fileName: string): string | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findRawFile(full, fileName);
      if (hit !== null) return hit;
    } else if (entry.name === fileName) {
      return full;
    }
  }
  return null;
}

interface PrMeasurement {
  id: string;
  repo: string;
  headSha: string;
  outcome: string;
  outcomeBad: boolean;
  /** 'measured' once the EG layer ran; otherwise a provisioning classification. */
  status: 'measured' | 'provision-failed' | 'no-diff';
  /** Classification of a provisioning failure: a screen defect (the screen said
   *  viable but it is not) or genuinely non-viable for an out-of-screen reason. */
  classification?: 'screen-defect' | 'non-viable-out-of-screen';
  mutationRan: boolean;
  coverageRan: boolean;
  /** Structural findings this run backed with a runtime signal (the corroborated
   *  subset). On an outcome-clean PR each is a corroborated false positive. */
  corroboratedFindings: { category: string; file: string; line: number; signal: string }[];
  skipped: string[];
}

async function measureOne(rec: ViabilityRecord): Promise<PrMeasurement> {
  const outcomeBad = rec.outcome === 'reverted' || rec.outcome === 'hotfixed';
  const base: PrMeasurement = {
    id: rec.id,
    repo: rec.repo,
    headSha: rec.headSha,
    outcome: rec.outcome,
    outcomeBad,
    status: 'no-diff',
    mutationRan: false,
    coverageRan: false,
    corroboratedFindings: [],
    skipped: [],
  };
  const jsonPath = findRawFile(RAW_DIR, `${rec.id}.json`);
  if (jsonPath === null) return base;
  const diffPath = path.join(path.dirname(jsonPath), `${rec.id}.diff`);
  if (!fs.existsSync(diffPath)) return base;
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as RawPr;
  const prDiff = fs.readFileSync(diffPath, 'utf8');
  const pr = raw.pr;
  const prNumber = pr.number ?? Number.parseInt(rec.id.split('-pr').pop() ?? '0', 10);

  const manifestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-egv-manifest-'));
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-egv-ws-'));
  try {
    const audit = await runCheatDetectors({
      unifiedDiff: prDiff,
      repoRoot: manifestDir,
      pr: {
        number: prNumber,
        headSha: pr.headSha,
        baseSha: pr.baseSha ?? '',
        title: pr.title ?? '',
        body: pr.body ?? '',
        author: '',
        headRef: '',
        repository: pr.repository,
      },
    });
    const config: ExecutionGroundedConfig = {
      enabled: true,
      mutation: true,
      coverage: true,
      issueRepro: false,
      runner: 'host',
      corroborateStructural: true,
      maxWallClockPerPrMs: Number(process.env.SWARM_EG_WALLCLOCK_MS ?? 20 * 60 * 1000),
    };
    const outcome = await runExecutionGrounded({
      prDiff,
      repo: rec.repo,
      prNumber,
      prHeadSha: pr.headSha,
      ...(pr.baseSha !== undefined ? { prBaseSha: pr.baseSha } : {}),
      ...(pr.title !== undefined ? { prTitle: pr.title } : {}),
      ...(pr.body !== undefined ? { prBody: pr.body } : {}),
      config,
      baseDir,
      installTimeoutMs: Number(process.env.SWARM_EG_INSTALL_TIMEOUT_MS ?? 10 * 60 * 1000),
      structuralFindings: audit.findings,
    });

    base.skipped = outcome.skipped;
    base.mutationRan = outcome.mutationRuns.some((r) => r.outcome.ran);
    base.coverageRan = outcome.coverageRuns.some((r) => r.outcome.ran);
    const provisionFailed = outcome.skipped.some((s) => s.startsWith('provision:'));
    if (provisionFailed) {
      base.status = 'provision-failed';
      // Classify: the static screen passed (Node + lockfile + runner + engine),
      // so an install/clone failure here is an out-of-screen non-viability
      // (a private dep, a postinstall that needs a service), not a screen defect.
      // A screen defect would be a missing package.json / lockfile the screen
      // claimed existed; runCheatDetectors + the diff confirm those statically.
      base.classification = 'non-viable-out-of-screen';
      return base;
    }
    base.status = 'measured';
    for (const f of audit.findings) {
      if (f.runtimeCorroboration !== undefined) {
        base.corroboratedFindings.push({
          category: f.category,
          file: f.location.file,
          line: f.location.line,
          signal: f.runtimeCorroboration.signal,
        });
      }
    }
    return base;
  } catch (err) {
    base.status = 'provision-failed';
    base.classification = 'non-viable-out-of-screen';
    base.skipped.push(`error: ${err instanceof Error ? err.message : String(err)}`);
    return base;
  } finally {
    fs.rmSync(manifestDir, { recursive: true, force: true });
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
}

function writeResult(m: PrMeasurement): void {
  const dir = path.join(RESULTS_DIR, m.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'result.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), ...m }, null, 2)}\n`);
}

/** Fold every per-PR result on disk into the corroborated summary the promotions
 *  scripts read. Counts corroborated findings as TP on outcome-bad PRs and FP on
 *  outcome-clean PRs, per detector category. */
function aggregate(): void {
  if (!fs.existsSync(RESULTS_DIR)) {
    log.warn(`no results under ${RESULTS_DIR}; nothing to aggregate`);
    return;
  }
  const perDetector = new Map<string, { truePositive: number; falsePositive: number }>();
  let measured = 0;
  const ids: string[] = [];
  for (const id of fs.readdirSync(RESULTS_DIR)) {
    const file = path.join(RESULTS_DIR, id, 'result.json');
    if (!fs.existsSync(file)) continue;
    const m = JSON.parse(fs.readFileSync(file, 'utf8')) as PrMeasurement;
    ids.push(id);
    if (m.status === 'measured') measured += 1;
    for (const f of m.corroboratedFindings) {
      const d = perDetector.get(f.category) ?? { truePositive: 0, falsePositive: 0 };
      if (m.outcomeBad) d.truePositive += 1;
      else d.falsePositive += 1;
      perDetector.set(f.category, d);
    }
  }
  const out = {
    generatedAt: new Date().toISOString(),
    computedBy: 'scripts/real-prs/eg-viable-measure.ts --aggregate',
    note:
      'Corroborated TP/FP per detector over the EG-viable slice. Folded into the corroborated ' +
      'promotion tier by the promotions scripts. The viable slice is currently all outcome-clean, ' +
      'so any corroborated finding is a false positive; the tier stays advisory until the slice ' +
      'carries outcome-bad PRs (grown by the mining cron).',
    prsMeasured: measured,
    prsCovered: ids.length,
    corroboratedByDetector: Object.fromEntries(perDetector),
  };
  fs.writeFileSync(AGGREGATE_FILE, `${JSON.stringify(out, null, 2)}\n`);
  log.info(`aggregated ${ids.length} result(s) (${measured} measured) -> ${AGGREGATE_FILE}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.aggregate) {
    aggregate();
    return;
  }
  const viability = JSON.parse(fs.readFileSync(VIABILITY_FILE, 'utf8')) as ViabilityFile;
  const byId = new Map(viability.records.map((r) => [r.id, r]));
  let targets = viability.viableIds.map((id) => byId.get(id)).filter((r): r is ViabilityRecord => r !== undefined);
  if (args.only !== null) targets = targets.filter((r) => r.id === args.only);
  if (args.repo !== null) targets = targets.filter((r) => r.repo === args.repo);
  if (targets.length === 0) {
    log.error(`no EG-viable target matched (--only ${args.only ?? '-'} --repo ${args.repo ?? '-'})`);
    process.exitCode = 1;
    return;
  }

  for (const rec of targets) {
    log.info(`measuring ${rec.id} (${rec.repo})`);
    const m = await measureOne(rec);
    writeResult(m);
    log.info(
      `  ${rec.id}: status=${m.status}${m.classification ? ` (${m.classification})` : ''} ` +
        `mutation=${m.mutationRan} coverage=${m.coverageRan} corroborated=${m.corroboratedFindings.length}`,
    );
  }
}

if (require.main === module) {
  main().catch((err) => {
    log.error(`eg-viable-measure failed: ${err instanceof Error ? err.stack : String(err)}`);
    process.exitCode = 1;
  });
}
