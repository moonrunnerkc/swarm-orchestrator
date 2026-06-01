// Freezes "what the auditor does today" before any detector or judge
// source change. Runs the current cheat-detector registry deterministically
// over the synthetic and real corpora, then runs the judge confirmation
// gate (the only judge path that ships today) over the block findings it
// produces, and writes a per-detector / per-category metrics snapshot plus
// a human-readable summary.
//
// Every later "+N recall" / "-M FP" claim is computed against this
// snapshot. The deterministic detector numbers regenerate byte-identical;
// the judge numbers replay byte-identical from the committed judge cache
// (benchmarks/judge-cache/cache.json), so a fresh checkout reproduces the
// snapshot with no API key and no local model. Only the header timestamp
// changes between runs.
//
// Usage:
//   node dist/scripts/benchmarks/run-baseline.js [--no-judge] [--no-live]
//   --no-judge  skip the confirmation gate (deterministic numbers only)
//   --no-live   cache-only judge; never call a model (replay path)

import * as fs from 'fs';
import * as path from 'path';
import { runCheatDetectors } from '../../src/audit/cheat-detector';
import {
  CONFIRM_SYSTEM_PROMPT,
  buildConfirmationPrompt,
} from '../../src/audit/cheat-detector/llm-judge/anthropic-judge';
import { MAX_JUDGE_DIFF_CHARS } from '../../src/audit/cheat-detector/llm-judge';
import type { CheatCategory } from '../../src/audit/types';
import { loadDotenv } from '../../src/env-loader';
import {
  ALL_DETECTOR_CATEGORIES,
  expectedDetectorsFor,
} from '../corpus/score-real';
import {
  loadSyntheticCorpus,
  loadRealCorpus,
  readRealDiff,
  repoRoot,
} from './lib/corpora';
import { JudgeCache } from './lib/judge-cache';
import { BenchJudge, estimateHaikuUsd } from './lib/judge-client';
import { emptyCounts, precision, recall, round, p95, mean, type Counts } from './lib/metrics';

const CONFIRMABLE: ReadonlySet<CheatCategory> = new Set<CheatCategory>([
  'error-swallow',
  'mock-of-hallucination',
  'no-op-fix',
  'fake-refactor',
  'coverage-erosion',
  'test-relaxation',
  'assertion-strip',
]);

interface JudgeAccumulator {
  yes: number;
  no: number;
  unavailable: number;
  latencies: number[];
  costs: number[];
}

interface DetectorRow {
  category: CheatCategory;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
  judgeConfirmRate: number | null;
  meanJudgeCostUsd: number | null;
  p95LatencyMs: number | null;
}

interface CorpusReport {
  corpus: string;
  cases: number;
  perDetector: DetectorRow[];
}

interface JudgeSummary {
  model: string;
  provider: string;
  totalCalls: number;
  confirmRate: number | null;
  meanCostUsdHaikuListPrice: number | null;
  p95LatencyMs: number | null;
  note: string;
}

interface BaselineSnapshot {
  header: {
    tool: string;
    generatedAt: string;
    /** Operational, not a metric: how many judge calls went live vs were
     *  served from the committed cache this run. Lives in the header so
     *  the metrics below replay byte-identical. */
    liveJudgeCalls: number;
    note: string;
  };
  judge: JudgeSummary;
  corpora: CorpusReport[];
}

function capDiff(diff: string): string {
  if (diff.length <= MAX_JUDGE_DIFF_CHARS) return diff;
  return diff.slice(0, MAX_JUDGE_DIFF_CHARS);
}

function newAccumulators(): Map<CheatCategory, JudgeAccumulator> {
  const m = new Map<CheatCategory, JudgeAccumulator>();
  for (const cat of CONFIRMABLE) {
    m.set(cat, { yes: 0, no: 0, unavailable: 0, latencies: [], costs: [] });
  }
  return m;
}

async function judgeBlockFindings(
  judge: BenchJudge,
  acc: Map<CheatCategory, JudgeAccumulator>,
  prTitle: string,
  diff: string,
  blockCategories: ReadonlySet<CheatCategory>,
  allowLive: boolean,
): Promise<void> {
  const capped = capDiff(diff);
  for (const category of blockCategories) {
    if (!CONFIRMABLE.has(category)) continue;
    const bucket = acc.get(category);
    if (bucket === undefined) continue;
    const user = buildConfirmationPrompt(category, prTitle, capped);
    const answer = await judge.ask(CONFIRM_SYSTEM_PROMPT, user, allowLive);
    if (answer.answer === 'yes') bucket.yes += 1;
    else if (answer.answer === 'no') bucket.no += 1;
    else bucket.unavailable += 1;
    bucket.latencies.push(answer.latencyMs);
    bucket.costs.push(estimateHaikuUsd(answer.promptTokens, answer.completionTokens));
  }
}

function blockCategoriesOf(findings: { category: CheatCategory; severity: string }[]): Set<CheatCategory> {
  const set = new Set<CheatCategory>();
  for (const f of findings) {
    if (f.severity === 'block') set.add(f.category);
  }
  return set;
}

function buildRows(
  counts: Map<CheatCategory, Counts>,
  acc: Map<CheatCategory, JudgeAccumulator>,
): DetectorRow[] {
  return ALL_DETECTOR_CATEGORIES.map((category) => {
    const c = counts.get(category) ?? emptyCounts();
    const judge = acc.get(category);
    const confirmTotal = judge ? judge.yes + judge.no : 0;
    return {
      category,
      tp: c.tp,
      fp: c.fp,
      fn: c.fn,
      tn: c.tn,
      precision: round(precision(c)),
      recall: round(recall(c)),
      judgeConfirmRate:
        judge && confirmTotal > 0 ? round(judge.yes / confirmTotal) : null,
      meanJudgeCostUsd:
        judge && judge.costs.length > 0 ? round(mean(judge.costs), 6) : null,
      p95LatencyMs: judge && judge.latencies.length > 0 ? round(p95(judge.latencies), 1) : null,
    };
  });
}

async function scoreSynthetic(
  judge: BenchJudge,
  acc: Map<CheatCategory, JudgeAccumulator>,
  root: string,
  runJudge: boolean,
  allowLive: boolean,
): Promise<CorpusReport> {
  const corpus = loadSyntheticCorpus(root);
  const counts = new Map<CheatCategory, Counts>();
  for (const cat of ALL_DETECTOR_CATEGORIES) counts.set(cat, emptyCounts());
  for (const c of corpus.cases) {
    const broken = await runCheatDetectors({
      unifiedDiff: c.brokenDiff,
      repoRoot: root,
      detectorSet: 'experimental',
    });
    const clean = await runCheatDetectors({
      unifiedDiff: c.cleanDiff,
      repoRoot: root,
      detectorSet: 'experimental',
    });
    const brokenBlocks = blockCategoriesOf(broken.findings);
    const cleanBlocks = blockCategoriesOf(clean.findings);
    for (const cat of ALL_DETECTOR_CATEGORIES) {
      const bucket = counts.get(cat) as Counts;
      if (cat === c.category) {
        if (brokenBlocks.has(cat)) bucket.tp += 1;
        else bucket.fn += 1;
      }
      if (cleanBlocks.has(cat)) bucket.fp += 1;
      else if (cat === c.category) bucket.tn += 1;
    }
    if (runJudge) {
      await judgeBlockFindings(judge, acc, `synthetic ${c.category}`, c.brokenDiff, brokenBlocks, allowLive);
    }
  }
  return { corpus: 'synthetic', cases: corpus.cases.length, perDetector: buildRows(counts, acc) };
}

async function scoreReal(
  judge: BenchJudge,
  acc: Map<CheatCategory, JudgeAccumulator>,
  root: string,
  runJudge: boolean,
  allowLive: boolean,
): Promise<CorpusReport> {
  const { labeled } = await loadRealCorpus(root);
  const counts = new Map<CheatCategory, Counts>();
  for (const cat of ALL_DETECTOR_CATEGORIES) counts.set(cat, emptyCounts());
  let scored = 0;
  for (const entry of labeled) {
    if (entry.groundTruth.verdict === 'ambiguous') continue;
    scored += 1;
    const diff = readRealDiff(entry, root);
    const result = await runCheatDetectors({
      unifiedDiff: diff,
      repoRoot: root,
      detectorSet: 'experimental',
      pr: {
        number: entry.pr.number,
        headSha: entry.pr.headSha,
        baseSha: entry.pr.baseSha,
        title: entry.pr.title,
        body: entry.pr.body,
        author: entry.pr.author,
        headRef: entry.pr.headRef,
        repository: entry.pr.repository,
      },
    });
    const fired = blockCategoriesOf(result.findings);
    const isBroken = entry.groundTruth.verdict === 'broken';
    const expected = isBroken ? expectedDetectorsFor(entry) : new Set<CheatCategory>();
    for (const cat of ALL_DETECTOR_CATEGORIES) {
      const bucket = counts.get(cat) as Counts;
      const f = fired.has(cat);
      const e = expected.has(cat);
      if (f && e) bucket.tp += 1;
      else if (f && !e) bucket.fp += 1;
      else if (!f && e) bucket.fn += 1;
      else bucket.tn += 1;
    }
    if (runJudge) {
      await judgeBlockFindings(judge, acc, entry.pr.title, diff, fired, allowLive);
    }
  }
  return { corpus: 'real', cases: scored, perDetector: buildRows(counts, acc) };
}

function summariseJudge(
  judge: BenchJudge,
  acc: Map<CheatCategory, JudgeAccumulator>,
  runJudge: boolean,
): JudgeSummary {
  let yes = 0;
  let no = 0;
  let unavailable = 0;
  const latencies: number[] = [];
  const costs: number[] = [];
  for (const bucket of acc.values()) {
    yes += bucket.yes;
    no += bucket.no;
    unavailable += bucket.unavailable;
    latencies.push(...bucket.latencies);
    costs.push(...bucket.costs);
  }
  const confirmTotal = yes + no;
  const cfg = judge.config();
  return {
    model: cfg.model,
    provider: cfg.provider,
    totalCalls: yes + no + unavailable,
    confirmRate: runJudge && confirmTotal > 0 ? round(yes / confirmTotal) : null,
    meanCostUsdHaikuListPrice: runJudge && costs.length > 0 ? round(mean(costs), 6) : null,
    p95LatencyMs: runJudge && latencies.length > 0 ? round(p95(latencies), 1) : null,
    note:
      'Pre-upgrade judge is the confirmation gate only: it can downgrade a ' +
      'block, never raise a new finding. Cost is a Haiku list-price estimate ' +
      'from token counts; the benchmark ran against ' +
      (cfg.provider === 'local' ? `the local model ${cfg.model}` : cfg.model) +
      '. Latency reflects the machine that filled the committed cache.',
  };
}

function renderReadme(snapshot: BaselineSnapshot): string {
  const lines: string[] = [];
  lines.push('# Pre-upgrade baseline');
  lines.push('');
  lines.push(
    'Frozen detector and judge behavior captured before the defect-injection ' +
      'oracle work. Every recall / false-positive delta in the A/B report is ' +
      'computed against `metrics.json` in this directory.',
  );
  lines.push('');
  lines.push('Regenerate: `npm run benchmarks:baseline`. The deterministic detector');
  lines.push('numbers are byte-identical across runs; the judge numbers replay from');
  lines.push('`benchmarks/judge-cache/cache.json`. Only the header timestamp changes.');
  lines.push('');
  lines.push('## Judge');
  lines.push('');
  lines.push(`- model: \`${snapshot.judge.model}\` (${snapshot.judge.provider})`);
  lines.push(`- confirmation calls: ${snapshot.judge.totalCalls}`);
  lines.push(
    `- confirm rate (judge says the flagged block is real): ${fmt(snapshot.judge.confirmRate)}`,
  );
  lines.push(`- mean cost / call (Haiku list price estimate): ${fmtUsd(snapshot.judge.meanCostUsdHaikuListPrice)}`);
  lines.push(`- p95 latency: ${fmtMs(snapshot.judge.p95LatencyMs)}`);
  lines.push('');
  for (const corpus of snapshot.corpora) {
    lines.push(`## ${corpus.corpus} corpus (${corpus.cases} cases)`);
    lines.push('');
    lines.push('| detector | tp | fp | fn | precision | recall | judge confirm |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const row of corpus.perDetector) {
      lines.push(
        `| ${row.category} | ${row.tp} | ${row.fp} | ${row.fn} | ` +
          `${fmt(row.precision)} | ${fmt(row.recall)} | ${fmt(row.judgeConfirmRate)} |`,
      );
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function fmt(v: number | null): string {
  return v === null ? 'n/a' : v.toFixed(3);
}
function fmtUsd(v: number | null): string {
  return v === null ? 'n/a' : `$${v.toFixed(6)}`;
}
function fmtMs(v: number | null): string {
  return v === null ? 'n/a' : `${v.toFixed(0)} ms`;
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const runJudge = !argv.includes('--no-judge');
  const allowLive = !argv.includes('--no-live');
  // The confirmation gate only changes outcomes where a block fired and a
  // legitimate explanation exists, which is the real corpus. On synthetic
  // the confirmable detectors are already precision 1.0, so the gate just
  // re-confirms true positives. Judge synthetic only when explicitly asked.
  const judgeSynthetic = runJudge && argv.includes('--judge-synthetic');
  loadDotenv();
  const root = repoRoot();
  const cache = new JudgeCache(root);
  const judge = new BenchJudge(cache);
  const acc = newAccumulators();

  const synthetic = await scoreSynthetic(judge, acc, root, judgeSynthetic, allowLive);
  const real = await scoreReal(judge, acc, root, runJudge, allowLive);
  cache.flush();

  const snapshot: BaselineSnapshot = {
    header: {
      tool: 'run-baseline',
      generatedAt: new Date().toISOString(),
      liveJudgeCalls: judge.liveCallCount(),
      note: 'header fields are operational; all metrics below replay byte-identical from the committed judge cache.',
    },
    judge: summariseJudge(judge, acc, runJudge),
    corpora: [synthetic, real],
  };

  const outDir = path.join(root, 'benchmarks', 'baselines', 'pre-upgrade');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'metrics.json'),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(path.join(outDir, 'README.md'), renderReadme(snapshot), 'utf8');

  process.stdout.write(
    `run-baseline: synthetic=${synthetic.cases} real=${real.cases} ` +
      `judge-calls=${snapshot.judge.totalCalls} (live=${snapshot.header.liveJudgeCalls}) ` +
      `confirm-rate=${fmt(snapshot.judge.confirmRate)}\n`,
  );
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(`run-baseline: ${(err as Error).message}\n`);
    process.exitCode = 1;
  });
}

export { main };
