// Reproducible scorer for the v10 leaderboard.
//
// Reads benchmarks/falsification-corpus/v10-corpus/index.json, replays
// every (broken, clean) pair through `runCheatDetectors`, and emits an
// aggregated JSON document under benchmarks/leaderboard/results.json
// plus a copy under docs/leaderboard/data.json that the static site
// renders.
//
// `npm run leaderboard` runs this script and exits non-zero when any
// `expectedBrokenDetected: true` case fails to fire or any clean
// control returns a blocking finding — i.e. it doubles as a Phase 1
// exit-criterion CI gate.

import * as fs from 'fs';
import * as path from 'path';
import { runCheatDetectors } from '../../src/audit/cheat-detector';

interface CaseEntry {
  id: string;
  category: string;
  brokenPath: string;
  cleanPath: string;
  agentTag: string;
  expectedBrokenDetected: true;
  expectedCleanDetected: false;
}

interface CorpusIndex {
  generatedAt: string;
  totalCases: number;
  categories: string[];
  cases: CaseEntry[];
}

interface CaseResult {
  caseId: string;
  category: string;
  agentTag: string;
  brokenCaught: boolean;
  cleanFalsePositive: boolean;
}

interface AggregateRow {
  agent: string;
  category: string;
  total: number;
  caught: number;
  cleanFalsePositives: number;
  catchRate: number;
}

interface LeaderboardOutput {
  generatedAt: string;
  corpusGeneratedAt: string;
  corpusSize: number;
  detectorVersions: Record<string, string>;
  perAgent: Array<{ agent: string; total: number; caught: number; catchRate: number }>;
  perCategory: Array<{ category: string; total: number; caught: number; catchRate: number }>;
  perAgentCategory: AggregateRow[];
  failedExpectations: Array<{ caseId: string; reason: string }>;
}

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      const text = fs.readFileSync(candidate, 'utf8');
      if (text.includes('"swarm-orchestrator"')) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`leaderboard: could not locate repo root from ${start}`);
}

const REPO_ROOT = findRepoRoot(__dirname);
const CORPUS_ROOT = path.join(REPO_ROOT, 'benchmarks', 'falsification-corpus', 'v10-corpus');
const RESULTS_PATH = path.join(REPO_ROOT, 'benchmarks', 'leaderboard', 'results.json');
const SITE_DATA_PATH = path.join(REPO_ROOT, 'docs', 'leaderboard', 'data.json');

function loadIndex(): CorpusIndex {
  const raw = fs.readFileSync(path.join(CORPUS_ROOT, 'index.json'), 'utf8');
  return JSON.parse(raw) as CorpusIndex;
}

function loadDiff(rel: string): string {
  return fs.readFileSync(path.join(CORPUS_ROOT, rel), 'utf8');
}

export function scoreCorpus(): LeaderboardOutput {
  const index = loadIndex();
  const failedExpectations: LeaderboardOutput['failedExpectations'] = [];
  const caseResults: CaseResult[] = [];

  // Tracked once per run; detector versions are read off the first result.
  let detectorVersions: Record<string, string> = {};

  for (const entry of index.cases) {
    const brokenDiff = loadDiff(entry.brokenPath);
    const cleanDiff = loadDiff(entry.cleanPath);
    const brokenResult = runCheatDetectors({ unifiedDiff: brokenDiff, repoRoot: CORPUS_ROOT });
    const cleanResult = runCheatDetectors({ unifiedDiff: cleanDiff, repoRoot: CORPUS_ROOT });
    if (Object.keys(detectorVersions).length === 0) {
      detectorVersions = brokenResult.detectorVersions;
    }
    const brokenCaught = brokenResult.findings.some(
      (f) => f.category === entry.category && f.severity === 'block',
    ) || brokenResult.findings.some((f) => f.category === entry.category);
    const cleanFalsePositive = cleanResult.findings.some(
      (f) => f.category === entry.category && f.severity === 'block',
    );
    caseResults.push({
      caseId: entry.id,
      category: entry.category,
      agentTag: entry.agentTag,
      brokenCaught,
      cleanFalsePositive,
    });
    if (!brokenCaught) {
      failedExpectations.push({
        caseId: entry.id,
        reason: `category=${entry.category} expected to be detected on broken fixture, but no finding fired`,
      });
    }
    if (cleanFalsePositive) {
      failedExpectations.push({
        caseId: entry.id,
        reason: `category=${entry.category} clean control produced a blocking finding (false positive)`,
      });
    }
  }

  const perAgent = aggregate(caseResults, (r) => r.agentTag);
  const perCategory = aggregate(caseResults, (r) => r.category);
  const perAgentCategory = aggregateBoth(caseResults);
  return {
    generatedAt: new Date().toISOString(),
    corpusGeneratedAt: index.generatedAt,
    corpusSize: index.cases.length,
    detectorVersions,
    perAgent: perAgent.map(({ key, total, caught }) => ({
      agent: key,
      total,
      caught,
      catchRate: total === 0 ? 0 : caught / total,
    })),
    perCategory: perCategory.map(({ key, total, caught }) => ({
      category: key,
      total,
      caught,
      catchRate: total === 0 ? 0 : caught / total,
    })),
    perAgentCategory,
    failedExpectations,
  };
}

function aggregate(
  rows: readonly CaseResult[],
  key: (r: CaseResult) => string,
): Array<{ key: string; total: number; caught: number }> {
  const bucket = new Map<string, { total: number; caught: number }>();
  for (const r of rows) {
    const k = key(r);
    const cur = bucket.get(k) ?? { total: 0, caught: 0 };
    cur.total += 1;
    if (r.brokenCaught) cur.caught += 1;
    bucket.set(k, cur);
  }
  return Array.from(bucket.entries())
    .map(([k, v]) => ({ key: k, ...v }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function aggregateBoth(rows: readonly CaseResult[]): AggregateRow[] {
  const bucket = new Map<string, { total: number; caught: number; cleanFalsePositives: number }>();
  for (const r of rows) {
    const k = `${r.agentTag}|${r.category}`;
    const cur = bucket.get(k) ?? { total: 0, caught: 0, cleanFalsePositives: 0 };
    cur.total += 1;
    if (r.brokenCaught) cur.caught += 1;
    if (r.cleanFalsePositive) cur.cleanFalsePositives += 1;
    bucket.set(k, cur);
  }
  return Array.from(bucket.entries())
    .map(([k, v]) => {
      const [agent, category] = k.split('|');
      return {
        agent: agent ?? '',
        category: category ?? '',
        total: v.total,
        caught: v.caught,
        cleanFalsePositives: v.cleanFalsePositives,
        catchRate: v.total === 0 ? 0 : v.caught / v.total,
      };
    })
    .sort((a, b) => a.agent.localeCompare(b.agent) || a.category.localeCompare(b.category));
}

function writeResults(out: LeaderboardOutput): void {
  fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(SITE_DATA_PATH), { recursive: true });
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(out, null, 2) + '\n');
  fs.writeFileSync(SITE_DATA_PATH, JSON.stringify(out, null, 2) + '\n');
}

function main(): void {
  const out = scoreCorpus();
  writeResults(out);
  process.stdout.write(
    `leaderboard: ${out.corpusSize} cases, ` +
      `${out.perAgent.length} agents, ${out.perCategory.length} categories, ` +
      `${out.failedExpectations.length} failed expectation(s)\n`,
  );
  if (out.failedExpectations.length > 0) {
    for (const f of out.failedExpectations.slice(0, 10)) {
      process.stderr.write(`  ${f.caseId}: ${f.reason}\n`);
    }
    if (out.failedExpectations.length > 10) {
      process.stderr.write(`  ... and ${out.failedExpectations.length - 10} more\n`);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
