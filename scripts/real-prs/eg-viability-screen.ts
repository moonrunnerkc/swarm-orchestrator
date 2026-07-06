// Part D: a cheap static viability screen for the execution-grounded layer.
//
// Full-corpus EG sweeps are forbidden (slow, and most arbitrary demo repos do
// not provision). Before spending any sandbox time we ask, per outcome-labeled
// PR, whether the repo could even run: is it a Node project (package.json), does
// it pin its install (a lockfile), does it declare a recognizable test runner,
// and is its node engine satisfiable. Only the slice that passes is worth an EG
// run; everything else is recorded as not-viable with its per-PR reason, so the
// corroborated tier reports measured-on-N-viable or measured-zero-viable rather
// than the honest-but-opaque "unmeasured".
//
// Static and bounded: one GitHub contents listing of the repo root at the PR's
// sha, plus one package.json fetch when present. No clone, no install.
//
// Usage:
//   node dist/scripts/real-prs/eg-viability-screen.js [--refresh]

import * as fs from 'fs';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { makeOctokit, parseRepo, resolveGithubToken } from './lib/github';

const log = getLogger('real-prs:eg-viability');

const OUTCOME_FILE = path.join('benchmarks', 'real-corpus', 'outcome-labels.json');
const CACHE_DIR = path.join('benchmarks', 'real-corpus', 'eg-viability-cache');
const OUT_FILE = path.join('benchmarks', 'real-corpus', 'eg-viability.json');

// The EG layer's mutation (Stryker) and coverage paths target the JS/TS test
// ecosystem; a recognizable runner is the gate for "tests could run at all".
const KNOWN_RUNNERS = ['vitest', 'jest', 'mocha', 'ava', 'jasmine', 'node:test', 'tap', 'uvu'];
const LOCKFILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'npm-shrinkwrap.json', 'bun.lockb'];
// Non-Node ecosystems the gate's pytest and Go runners can provision and run.
// Root-level markers only, matching the screen's cheapness and the src-side
// detectNonNodeRunner seam. A Go module runs under `go test`; a Python project
// with a pytest signal (a pytest config or a tests directory) runs under pytest.
const PY_PROJECT_FILES = ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt'];
const PY_PYTEST_FILES = ['pytest.ini', 'tox.ini', 'conftest.py'];
// Installed runtime the EG evidence run pins (SWARM_EG_NODE_BIN=node@22).
const EG_NODE_MAJOR = 22;

export interface OutcomeLabel {
  id: string;
  repo: string;
  headSha: string;
  outcome: string;
}

interface OutcomeLabelsFile {
  labels: OutcomeLabel[];
}

export interface ViabilityRecord {
  id: string;
  repo: string;
  headSha: string;
  outcome: string;
  ecosystem: 'node' | 'python' | 'go' | null;
  hasPackageJson: boolean;
  hasLockfile: boolean;
  lockfile: string | null;
  testRunner: string | null;
  nodeEngine: string | null;
  nodeSatisfiable: boolean;
  viable: boolean;
  reason: string;
}

interface RootEntry {
  name: string;
  type: string;
}

export interface OctokitContents {
  repos: {
    getContent(p: { owner: string; repo: string; path: string; ref: string }): Promise<{
      data: unknown;
    }>;
  };
}

function readJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function statusOf(err: unknown): number | undefined {
  return (err as { status?: number }).status;
}

/** Major version range satisfiability, conservative: absent engine => yes;
 *  a range that obviously excludes 22 => no; otherwise yes. We only need to
 *  exclude repos that pin an old major (e.g. "14.x", "<16"). */
function nodeSatisfiable(engine: string | null): boolean {
  if (engine === null || engine.trim().length === 0) return true;
  const majors = [...engine.matchAll(/(\d+)/g)].map((m) => Number(m[1]));
  if (majors.length === 0) return true;
  // If the engine names only majors all below the EG runtime and uses an upper
  // bound, treat as not satisfiable; a `>=` lower bound at/under 22 is fine.
  if (/<\s*\d+/.test(engine)) {
    const upper = Number((engine.match(/<\s*(\d+)/) ?? [])[1]);
    if (Number.isFinite(upper) && upper <= EG_NODE_MAJOR) return false;
  }
  // A bare pin like "18" or "18.x" with no range operator: satisfiable only if
  // it includes 22 conceptually; a single pin != 22 is not satisfiable.
  if (/^\s*\d+(\.\d+|\.x)?\s*$/.test(engine)) {
    return Number(majors[0]) === EG_NODE_MAJOR;
  }
  return true;
}

export async function screenPr(
  octokit: OctokitContents,
  label: OutcomeLabel,
): Promise<ViabilityRecord> {
  const base = {
    id: label.id,
    repo: label.repo,
    headSha: label.headSha,
    outcome: label.outcome,
    ecosystem: null as 'node' | 'python' | 'go' | null,
    hasPackageJson: false,
    hasLockfile: false,
    lockfile: null as string | null,
    testRunner: null as string | null,
    nodeEngine: null as string | null,
    nodeSatisfiable: false,
    viable: false,
  };
  const target = parseRepo(label.repo);
  let root: RootEntry[];
  try {
    const res = await octokit.repos.getContent({
      owner: target.owner,
      repo: target.repo,
      path: '',
      ref: label.headSha,
    });
    if (!Array.isArray(res.data)) {
      return { ...base, reason: 'repo root is not a directory listing' };
    }
    root = res.data as RootEntry[];
  } catch (err) {
    return { ...base, reason: `repo/sha contents unreadable (HTTP ${statusOf(err) ?? '?'})` };
  }
  const names = new Set(root.filter((e) => e.type === 'file').map((e) => e.name));
  const dirs = new Set(root.filter((e) => e.type === 'dir').map((e) => e.name));
  const hasPackageJson = names.has('package.json');
  const lockfile = LOCKFILES.find((l) => names.has(l)) ?? null;
  if (!hasPackageJson) {
    // Go module: `go test` needs no declared runner, so go.mod is enough.
    if (names.has('go.mod')) {
      return { ...base, ecosystem: 'go', testRunner: 'go-test', viable: true, reason: 'viable: Go module (go.mod)' };
    }
    // Python project with a pytest signal (a pytest config or a tests dir).
    const isPython = PY_PROJECT_FILES.some((f) => names.has(f));
    const hasPytestSignal =
      PY_PYTEST_FILES.some((f) => names.has(f)) || dirs.has('tests') || dirs.has('test');
    if (isPython && hasPytestSignal) {
      return { ...base, ecosystem: 'python', testRunner: 'pytest', viable: true, reason: 'viable: Python + pytest signal' };
    }
    const why = isPython ? 'Python project but no pytest signal' : 'not a Node, Go, or pytest project';
    return { ...base, hasLockfile: lockfile !== null, lockfile, reason: `no package.json (${why})` };
  }

  let pkg: { scripts?: Record<string, string>; devDependencies?: Record<string, string>; dependencies?: Record<string, string>; engines?: { node?: string } } = {};
  try {
    const res = await octokit.repos.getContent({
      owner: target.owner,
      repo: target.repo,
      path: 'package.json',
      ref: label.headSha,
    });
    const data = res.data as { content?: string; encoding?: string };
    if (typeof data.content === 'string') {
      pkg = JSON.parse(Buffer.from(data.content, (data.encoding as BufferEncoding) ?? 'base64').toString('utf8'));
    }
  } catch (err) {
    return { ...base, hasPackageJson: true, hasLockfile: lockfile !== null, lockfile, reason: `package.json unreadable (HTTP ${statusOf(err) ?? '?'})` };
  }

  const deps = { ...(pkg.devDependencies ?? {}), ...(pkg.dependencies ?? {}) };
  const testScript = pkg.scripts?.test ?? '';
  const runner =
    KNOWN_RUNNERS.find((r) => r in deps) ??
    KNOWN_RUNNERS.find((r) => testScript.includes(r) || (r === 'node:test' && /node --test/.test(testScript))) ??
    null;
  const nodeEngine = pkg.engines?.node ?? null;
  const nodeOk = nodeSatisfiable(nodeEngine);

  const viable = hasPackageJson && lockfile !== null && runner !== null && nodeOk;
  const reasons: string[] = [];
  if (lockfile === null) reasons.push('no lockfile');
  if (runner === null) reasons.push('no recognizable test runner');
  if (!nodeOk) reasons.push(`node engine "${nodeEngine}" excludes ${EG_NODE_MAJOR}`);
  return {
    ...base,
    ecosystem: 'node',
    hasPackageJson: true,
    hasLockfile: lockfile !== null,
    lockfile,
    testRunner: runner,
    nodeEngine,
    nodeSatisfiable: nodeOk,
    viable,
    reason: viable ? 'viable: Node + lockfile + runner + node engine OK' : reasons.join('; '),
  };
}

async function main(): Promise<void> {
  loadDotenv();
  const refresh = process.argv.includes('--refresh');
  const octokit = makeOctokit(resolveGithubToken()) as unknown as OctokitContents;

  const outcome = readJson<OutcomeLabelsFile>(OUTCOME_FILE);
  if (outcome === null) {
    throw new Error(`missing ${OUTCOME_FILE}; run labeling:outcome first`);
  }
  const usable = outcome.labels.filter((l) => l.outcome !== 'indeterminate');
  log.info(`screening ${usable.length} usable outcome-labeled PRs for EG viability`);

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const records: ViabilityRecord[] = [];
  let queried = 0;
  for (const label of usable) {
    const cacheFile = path.join(CACHE_DIR, `${label.id}.json`);
    if (!refresh) {
      const cached = readJson<ViabilityRecord>(cacheFile);
      if (cached !== null) {
        records.push(cached);
        continue;
      }
    }
    const rec = await screenPr(octokit, label);
    writeJson(cacheFile, rec);
    records.push(rec);
    queried += 1;
    if (queried % 25 === 0) log.info(`screened ${records.length}/${usable.length} (${queried} live)`);
  }

  const viable = records.filter((r) => r.viable);
  // The proof tier (mutation, coverage, restoration) provisions with Node
  // package managers only, so the count that actually provisions the proof
  // tier is the Node-viable subset, distinct from the broader screen viability
  // (which also recognizes pytest and Go). compute-promotions reads this count
  // for the corroborated tier so the "PRs provision" claim stays honest until
  // the Python and Go install paths land.
  const provisionable = viable.filter((r) => r.ecosystem === 'node');
  const viableByEcosystem: Record<string, number> = {};
  for (const r of viable) {
    const eco = r.ecosystem ?? 'unknown';
    viableByEcosystem[eco] = (viableByEcosystem[eco] ?? 0) + 1;
  }
  const reasons: Record<string, number> = {};
  for (const r of records) {
    if (r.viable) continue;
    reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  }
  const out = {
    generatedAt: new Date().toISOString(),
    computedBy: 'scripts/real-prs/eg-viability-screen.ts',
    egNodeMajor: EG_NODE_MAJOR,
    screened: records.length,
    viableCount: viable.length,
    viableByEcosystem,
    provisionableCount: provisionable.length,
    viableIds: viable.map((v) => v.id),
    nonViableReasonCounts: reasons,
    records,
  };
  writeJson(OUT_FILE, out);
  log.info(
    `EG viability: ${viable.length}/${records.length} viable; wrote ${OUT_FILE}. ` +
      `non-viable reasons: ${Object.entries(reasons).map(([k, v]) => `${v}× ${k}`).join(' | ')}`,
  );
}

// Guard the entry point so importing this module for its reusable screen
// (screenPr) does not kick off a live 197-PR viability run as a side effect.
if (require.main === module) {
  main().catch((err: unknown) => {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  });
}
