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
// Installed runtime the EG evidence run pins (SWARM_EG_NODE_BIN=node@22).
const EG_NODE_MAJOR = 22;

interface OutcomeLabel {
  id: string;
  repo: string;
  headSha: string;
  outcome: string;
}

interface OutcomeLabelsFile {
  labels: OutcomeLabel[];
}

interface ViabilityRecord {
  id: string;
  repo: string;
  headSha: string;
  outcome: string;
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

interface OctokitContents {
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

async function screenPr(octokit: OctokitContents, label: OutcomeLabel): Promise<ViabilityRecord> {
  const base = {
    id: label.id,
    repo: label.repo,
    headSha: label.headSha,
    outcome: label.outcome,
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
  const hasPackageJson = names.has('package.json');
  const lockfile = LOCKFILES.find((l) => names.has(l)) ?? null;
  if (!hasPackageJson) {
    return { ...base, hasLockfile: lockfile !== null, lockfile, reason: 'no package.json (not a Node project)' };
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

main().catch((err: unknown) => {
  log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
