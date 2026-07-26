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
import { makeOctokit, parseRepo, resolveGithubToken, type RepoTarget } from './lib/github';
import { subdirManifestCandidates } from './lib/subdir-manifest-screen';

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
  /** Present when viability comes from a subdirectory manifest (B2 discovery
   *  mirror): the repo-relative directory that screened viable. Root-viable
   *  and pre-B2 records lack it. */
  manifestDir?: string;
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
  /** Recursive tree listing, used only when the repo root has no manifest (the
   *  B2 subdirectory-manifest discovery mirror). Optional so pre-B2 fakes and
   *  callers keep working; without it the screen behaves exactly as before. */
  git?: {
    getTree(p: { owner: string; repo: string; tree_sha: string; recursive: string }): Promise<{
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

/** Whether a single `||`-free engine alternative admits the pinned EG runtime. */
function alternativeSatisfiable(alternative: string): boolean {
  const alt = alternative.trim();
  const majors = [...alt.matchAll(/(\d+)/g)].map((m) => Number(m[1]));
  if (majors.length === 0) return true;
  // An upper bound at/under the EG runtime excludes it; a `>=` lower bound is fine.
  if (/<\s*\d+/.test(alt)) {
    const upper = Number((alt.match(/<\s*(\d+)/) ?? [])[1]);
    if (Number.isFinite(upper) && upper <= EG_NODE_MAJOR) return false;
  }
  // A bare pin like "18" or "18.x": satisfiable only when it is the EG major.
  if (/^\s*\d+(\.\d+|\.x)?\s*$/.test(alt)) {
    return Number(majors[0]) === EG_NODE_MAJOR;
  }
  return true;
}

/** Major version range satisfiability, conservative: absent engine => yes;
 *  a range that obviously excludes 22 => no; otherwise yes. A `||` range is
 *  satisfiable when any alternative is, so an OR that names 22 alongside an
 *  excluding clause (e.g. ">=20.12 <21 || 22 || 24") is admitted rather than
 *  rejected on the first clause. We only need to exclude repos that pin an old
 *  major (e.g. "14.x", "<16") with no clause admitting 22. */
function nodeSatisfiable(engine: string | null): boolean {
  if (engine === null || engine.trim().length === 0) return true;
  return engine.split('||').some(alternativeSatisfiable);
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
    const rootMiss = { ...base, hasLockfile: lockfile !== null, lockfile, reason: `no package.json (${why})` };
    return screenSubdirManifests(octokit, target, label.headSha, base, rootMiss);
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

/** The package.json fields the node-candidate screen reads. */
interface ScreenedPackageJson {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
  engines?: { node?: string };
}

/** Live subdir package.json fetches per repo, so one screen stays cheap. */
const MAX_SUBDIR_NODE_FETCHES = 3;

/**
 * Screen subdirectory manifests for a repo whose root has none, mirroring the
 * provisioner's B2 discovery. One recursive tree listing, then the same
 * lockfile/runner/engine checks against the shallowest candidates (at most
 * MAX_SUBDIR_NODE_FETCHES subdir package.json fetches). The screen has no PR
 * diff, so a viable result is an upper bound: the provisioner's ownership rule
 * decides per PR, and the reason says so.
 *
 * @param octokit the contents/tree client.
 * @param target the owner/repo.
 * @param headSha the pinned commit.
 * @param base the field skeleton screenPr built.
 * @param rootMiss the pre-discovery not-viable record, returned unchanged when
 *   discovery cannot run or finds nothing.
 * @returns a viable record naming its manifestDir, or a not-viable record whose
 *   reason lists what each candidate was missing.
 */
async function screenSubdirManifests(
  octokit: OctokitContents,
  target: RepoTarget,
  headSha: string,
  base: Omit<ViabilityRecord, 'reason'>,
  rootMiss: ViabilityRecord,
): Promise<ViabilityRecord> {
  if (octokit.git === undefined) return rootMiss;
  let paths: string[];
  try {
    const res = await octokit.git.getTree({
      owner: target.owner,
      repo: target.repo,
      tree_sha: headSha,
      recursive: '1',
    });
    const data = res.data as { tree?: Array<{ path?: string; type?: string }> };
    paths = (data.tree ?? [])
      .filter((e) => e.type === 'blob' && typeof e.path === 'string')
      .map((e) => e.path!);
  } catch (err) {
    return { ...rootMiss, reason: `${rootMiss.reason}; tree unreadable (HTTP ${statusOf(err) ?? '?'})` };
  }
  const candidates = subdirManifestCandidates(paths);
  if (candidates.length === 0) return rootMiss;
  const pathSet = new Set(paths);
  const misses: string[] = [];
  let nodeFetches = 0;
  for (const cand of candidates) {
    if (cand.ecosystem === 'go') {
      return {
        ...base,
        ecosystem: 'go',
        testRunner: 'go-test',
        viable: true,
        manifestDir: cand.dir,
        reason: `viable: subdir Go module (${cand.dir}/go.mod); diff ownership decided at provision time`,
      };
    }
    if (cand.ecosystem === 'python') {
      return {
        ...base,
        ecosystem: 'python',
        testRunner: 'pytest',
        viable: true,
        manifestDir: cand.dir,
        reason: `viable: subdir Python + pytest signal (${cand.dir}); diff ownership decided at provision time`,
      };
    }
    if (nodeFetches >= MAX_SUBDIR_NODE_FETCHES) {
      misses.push(`${cand.dir} (over the fetch budget)`);
      continue;
    }
    nodeFetches += 1;
    let pkg: ScreenedPackageJson;
    try {
      const res = await octokit.repos.getContent({
        owner: target.owner,
        repo: target.repo,
        path: `${cand.dir}/package.json`,
        ref: headSha,
      });
      const data = res.data as { content?: string; encoding?: string };
      pkg =
        typeof data.content === 'string'
          ? (JSON.parse(
              Buffer.from(data.content, (data.encoding as BufferEncoding) ?? 'base64').toString('utf8'),
            ) as ScreenedPackageJson)
          : {};
    } catch (err) {
      misses.push(`${cand.dir} (package.json unreadable, HTTP ${statusOf(err) ?? '?'})`);
      continue;
    }
    const subLockfile = LOCKFILES.find((l) => pathSet.has(`${cand.dir}/${l}`)) ?? null;
    const deps = { ...(pkg.devDependencies ?? {}), ...(pkg.dependencies ?? {}) };
    const testScript = pkg.scripts?.test ?? '';
    const runner =
      KNOWN_RUNNERS.find((r) => r in deps) ??
      KNOWN_RUNNERS.find(
        (r) => testScript.includes(r) || (r === 'node:test' && /node --test/.test(testScript)),
      ) ??
      null;
    const nodeEngine = pkg.engines?.node ?? null;
    const nodeOk = nodeSatisfiable(nodeEngine);
    if (subLockfile !== null && runner !== null && nodeOk) {
      return {
        ...base,
        ecosystem: 'node',
        hasLockfile: true,
        lockfile: subLockfile,
        testRunner: runner,
        nodeEngine,
        nodeSatisfiable: nodeOk,
        viable: true,
        manifestDir: cand.dir,
        reason: `viable: subdir Node manifest (${cand.dir}) + lockfile + runner + node engine OK`,
      };
    }
    const parts: string[] = [];
    if (subLockfile === null) parts.push('no lockfile');
    if (runner === null) parts.push('no recognizable test runner');
    if (!nodeOk) parts.push(`node engine "${nodeEngine}" excludes ${EG_NODE_MAJOR}`);
    misses.push(`${cand.dir} (${parts.join(', ')})`);
  }
  return { ...rootMiss, reason: `no root manifest; subdir manifests not viable: ${misses.join('; ')}` };
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
  // Phase 1 wired pytest (venv + pip / poetry) and Go (go mod download) into the
  // sandbox install path, so a pytest or Go tree can now be cloned and installed.
  // provisionableCount stays the Node-viable subset on purpose: it counts the PRs
  // the corroboration engine (mutation, coverage, issue-repro) can actually score,
  // and that engine is still Node-only. A pytest/Go PR is install-provisionable but
  // not corroboration-scoreable, so folding it into this count would overstate the
  // measurable slice. compute-promotions and the corroborated-gate measurement read
  // this count, so it tracks corroboration reach, not install reach.
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
