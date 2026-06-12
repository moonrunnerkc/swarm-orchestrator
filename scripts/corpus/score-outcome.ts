// Score the v10 cheat-detector registry against OUTCOME-grounded ground truth.
//
// Where score-real.ts scores against per-category AI labels, this scorer scores
// against `benchmarks/real-corpus/outcome-labels.json`, where a PR's truth comes
// from repository history alone: reverted | hotfixed => "bad", survived =>
// "clean", indeterminate => excluded. Outcome labels carry no cheat *category*
// (history says a change was undone, not which detector should have caught it),
// so this scorer measures what outcome grounding can identify:
//
//   - PR level: the union of detectors as a single predictor. A PR is a positive
//     prediction if ANY detector fires (block severity); ground-truth positive
//     is reverted|hotfixed. precision and recall with Wilson 95% bounds.
//   - per detector, PR level: TP = fired on a bad PR, FP = fired on a survived
//     PR. precision (the gate metric) with Wilson bounds. recall here is the
//     detector's share of bad PRs it flags (outcome-catch), not category recall.
//   - per detector, finding level: precision = findings landing on bad PRs over
//     all of that detector's findings, with Wilson bounds. (Finding-level recall
//     is not identifiable without per-finding truth and is not reported.)
//
// Writes the rich report to `benchmarks/real-corpus/scores-outcome/latest.json`.
// With --write-canonical it also rewrites `benchmarks/real-corpus/scores/latest.json`
// in the ScoreSnapshot shape the promotions pipeline reads (outcome-grounded
// per-detector TP/FP/TN/FN), after preserving the prior AI-labeled snapshot to
// `scores/ai-labeled-baseline.json`. That is the deliberate switch to "all
// scoring runs against outcome labels".
//
// Usage:
//   node dist/scripts/corpus/score-outcome.js [--judge] [--write-canonical]

import * as fs from 'fs';
import * as path from 'path';
import { runCheatDetectors } from '../../src/audit/cheat-detector';
import type { CheatCategory } from '../../src/audit/types';
import { loadPrCorpus } from '../../benchmarks/real-corpus/loader';
import type { UnlabeledPrCorpusEntry } from '../../benchmarks/real-corpus/schema';
import { wilsonInterval, type WilsonInterval } from '../../src/audit/gate/wilson';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';

const log = getLogger('corpus:score-outcome');

const RAW_DIR = path.join('benchmarks', 'real-corpus', 'raw');
const OUTCOME_FILE = path.join('benchmarks', 'real-corpus', 'outcome-labels.json');
const OUT_DIR = path.join('benchmarks', 'real-corpus', 'scores-outcome');
const CANONICAL_DIR = path.join('benchmarks', 'real-corpus', 'scores');

const ALL_DETECTOR_CATEGORIES: readonly CheatCategory[] = [
  'test-relaxation',
  'mock-of-hallucination',
  'assertion-strip',
  'no-op-fix',
  'coverage-erosion',
  'fake-refactor',
  'comment-only-fix',
  'error-swallow',
  'exception-rethrow-lost-context',
  'dead-branch-insertion',
];

type Outcome = 'reverted' | 'hotfixed' | 'survived' | 'indeterminate';

interface OutcomeLabel {
  id: string;
  repo: string;
  outcome: Outcome;
  aiVerdict: 'clean' | 'broken' | 'ambiguous';
}

interface OutcomeLabelsFile {
  hotfixWindowDays: number;
  distribution: Record<Outcome, number>;
  labels: OutcomeLabel[];
}

interface DetectorOutcomeScore {
  detector: CheatCategory;
  // PR level
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  precision: number;
  recall: number;
  f1: number;
  precisionWilson: WilsonInterval;
  // finding level
  findingsTotal: number;
  findingsOnBad: number;
  findingPrecision: number;
  findingPrecisionWilson: WilsonInterval;
}

interface OutcomeScoreSnapshot {
  generatedAt: string;
  computedBy: string;
  outcomeLabelsFile: string;
  groundTruth: string;
  judgeEnabled: boolean;
  corpus: {
    totalLabeled: number;
    scored: number;
    excludedIndeterminate: number;
    outcomeBad: number;
    outcomeClean: number;
    hotfixWindowDays: number;
  };
  aggregatePrLevel: {
    truePositive: number;
    falsePositive: number;
    trueNegative: number;
    falseNegative: number;
    precision: number;
    recall: number;
    f1: number;
    precisionWilson: WilsonInterval;
    recallWilson: WilsonInterval;
  };
  perDetector: DetectorOutcomeScore[];
  detectorVersions: Record<string, string>;
}

interface Args {
  judge: boolean;
  writeCanonical: boolean;
}

function parseArgs(argv: string[]): Args {
  return {
    judge: argv.includes('--judge') || process.env.SWARM_AUDIT_LLM_JUDGE === '1',
    writeCanonical: argv.includes('--write-canonical'),
  };
}

function divide(num: number, den: number): number {
  return den === 0 ? 0 : num / den;
}

function f1Of(tp: number, fp: number, fn: number): number {
  const p = divide(tp, tp + fp);
  const r = divide(tp, tp + fn);
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.judge) loadDotenv();

  const outcomeFile = JSON.parse(fs.readFileSync(OUTCOME_FILE, 'utf8')) as OutcomeLabelsFile;
  const entries = await loadPrCorpus(RAW_DIR);
  const byId = new Map<string, UnlabeledPrCorpusEntry>();
  for (const e of entries) byId.set(e.id, e);

  const scored = outcomeFile.labels.filter((l) => l.outcome !== 'indeterminate');
  const isBad = (l: OutcomeLabel): boolean => l.outcome === 'reverted' || l.outcome === 'hotfixed';
  const totalBad = scored.filter(isBad).length;
  const totalClean = scored.length - totalBad;

  // Per-detector tallies.
  const pr = new Map<CheatCategory, { tp: number; fp: number }>();
  const find = new Map<CheatCategory, { total: number; onBad: number }>();
  for (const cat of ALL_DETECTOR_CATEGORIES) {
    pr.set(cat, { tp: 0, fp: 0 });
    find.set(cat, { total: 0, onBad: 0 });
  }
  let aggTp = 0;
  let aggFp = 0;
  let aggFn = 0;
  let aggTn = 0;
  let detectorVersions: Record<string, string> = {};
  const firings: {
    detector: CheatCategory;
    id: string;
    repo: string;
    outcome: Outcome;
    isFalsePositive: boolean;
    file: string;
    line: number;
    message: string;
    evidence: string;
  }[] = [];

  let processed = 0;
  for (const label of scored) {
    const entry = byId.get(label.id);
    if (entry === undefined) {
      log.warn(`no raw corpus entry for ${label.id}; skipping`);
      continue;
    }
    const diff = fs.readFileSync(path.join(RAW_DIR, entry.vendoredDiffPath), 'utf8');
    const result = await runCheatDetectors({
      unifiedDiff: diff,
      repoRoot: process.cwd(),
      detectorSet: 'experimental',
      judgeEnabled: args.judge,
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
    if (Object.keys(detectorVersions).length === 0) detectorVersions = result.detectorVersions;

    const bad = isBad(label);
    const firedCategories = new Set<CheatCategory>();
    for (const f of result.findings) {
      if (f.severity !== 'block') continue;
      firedCategories.add(f.category);
      const fl = find.get(f.category);
      if (fl !== undefined) {
        fl.total += 1;
        if (bad) fl.onBad += 1;
      }
      firings.push({
        detector: f.category,
        id: label.id,
        repo: label.repo,
        outcome: label.outcome,
        isFalsePositive: !bad,
        file: f.location.file,
        line: f.location.line,
        message: f.message,
        evidence: f.evidence,
      });
    }
    for (const cat of ALL_DETECTOR_CATEGORIES) {
      if (!firedCategories.has(cat)) continue;
      const b = pr.get(cat);
      if (b === undefined) continue;
      if (bad) b.tp += 1;
      else b.fp += 1;
    }
    const anyFired = firedCategories.size > 0;
    if (anyFired && bad) aggTp += 1;
    else if (anyFired && !bad) aggFp += 1;
    else if (!anyFired && bad) aggFn += 1;
    else aggTn += 1;

    processed += 1;
    if (processed % 25 === 0) log.info(`scored ${processed}/${scored.length}`);
  }

  const perDetector: DetectorOutcomeScore[] = ALL_DETECTOR_CATEGORIES.map((cat) => {
    const p = pr.get(cat) ?? { tp: 0, fp: 0 };
    const fl = find.get(cat) ?? { total: 0, onBad: 0 };
    const fn = totalBad - p.tp;
    const tn = totalClean - p.fp;
    return {
      detector: cat,
      truePositive: p.tp,
      falsePositive: p.fp,
      trueNegative: tn,
      falseNegative: fn,
      precision: divide(p.tp, p.tp + p.fp),
      recall: divide(p.tp, totalBad),
      f1: f1Of(p.tp, p.fp, fn),
      precisionWilson: wilsonInterval(p.tp, p.tp + p.fp),
      findingsTotal: fl.total,
      findingsOnBad: fl.onBad,
      findingPrecision: divide(fl.onBad, fl.total),
      findingPrecisionWilson: wilsonInterval(fl.onBad, fl.total),
    };
  });

  const snapshot: OutcomeScoreSnapshot = {
    generatedAt: new Date().toISOString(),
    computedBy: 'scripts/corpus/score-outcome.ts',
    outcomeLabelsFile: OUTCOME_FILE,
    groundTruth: 'repository-history-only (reverted|hotfixed=bad, survived=clean, indeterminate excluded)',
    judgeEnabled: args.judge,
    corpus: {
      totalLabeled: outcomeFile.labels.length,
      scored: scored.length,
      excludedIndeterminate: outcomeFile.labels.length - scored.length,
      outcomeBad: totalBad,
      outcomeClean: totalClean,
      hotfixWindowDays: outcomeFile.hotfixWindowDays,
    },
    aggregatePrLevel: {
      truePositive: aggTp,
      falsePositive: aggFp,
      trueNegative: aggTn,
      falseNegative: aggFn,
      precision: divide(aggTp, aggTp + aggFp),
      recall: divide(aggTp, aggTp + aggFn),
      f1: f1Of(aggTp, aggFp, aggFn),
      precisionWilson: wilsonInterval(aggTp, aggTp + aggFp),
      recallWilson: wilsonInterval(aggTp, aggTp + aggFn),
    },
    perDetector,
    detectorVersions,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'latest.json'), JSON.stringify(snapshot, null, 2) + '\n');
  firings.sort((a, b) =>
    a.detector === b.detector
      ? Number(a.isFalsePositive) - Number(b.isFalsePositive) || a.id.localeCompare(b.id)
      : a.detector.localeCompare(b.detector),
  );
  fs.writeFileSync(
    path.join(OUT_DIR, 'firings.json'),
    JSON.stringify({ generatedAt: snapshot.generatedAt, firings }, null, 2) + '\n',
  );
  log.info(`wrote ${path.join(OUT_DIR, 'latest.json')} and firings.json (${firings.length} block firings)`);

  if (args.writeCanonical) writeCanonical(snapshot);

  printSummary(snapshot);
}

/** Emit a ScoreSnapshot-shaped scores/latest.json the promotions pipeline reads,
 *  preserving the prior AI-labeled snapshot the first time. */
function writeCanonical(snapshot: OutcomeScoreSnapshot): void {
  const canonicalLatest = path.join(CANONICAL_DIR, 'latest.json');
  const baseline = path.join(CANONICAL_DIR, 'ai-labeled-baseline.json');
  if (fs.existsSync(canonicalLatest) && !fs.existsSync(baseline)) {
    fs.copyFileSync(canonicalLatest, baseline);
    log.info(`preserved prior AI-labeled snapshot to ${baseline}`);
  }
  const scoreSnapshot = {
    generatedAt: snapshot.generatedAt,
    rawDir: RAW_DIR,
    labelsDir: OUTCOME_FILE,
    groundTruth: snapshot.groundTruth,
    detectorVersions: snapshot.detectorVersions,
    perDetector: snapshot.perDetector.map((d) => ({
      detector: d.detector,
      truePositive: d.truePositive,
      falsePositive: d.falsePositive,
      trueNegative: d.trueNegative,
      falseNegative: d.falseNegative,
      precision: d.precision,
      recall: d.recall,
      f1: d.f1,
    })),
    aggregate: {
      overallPrecision: snapshot.aggregatePrLevel.precision,
      overallRecall: snapshot.aggregatePrLevel.recall,
      overallF1: snapshot.aggregatePrLevel.f1,
      totalLabeled: snapshot.corpus.totalLabeled,
      totalScored: snapshot.corpus.scored,
      totalAmbiguousExcluded: snapshot.corpus.excludedIndeterminate,
      totalCleanLabeled: snapshot.corpus.outcomeClean,
      totalBrokenLabeled: snapshot.corpus.outcomeBad,
    },
    unlabeledIds: [],
    invalidLabelIds: [],
  };
  fs.mkdirSync(CANONICAL_DIR, { recursive: true });
  fs.writeFileSync(canonicalLatest, JSON.stringify(scoreSnapshot, null, 2) + '\n');
  log.info(`rewrote ${canonicalLatest} (outcome-grounded; run promotions:compute to refresh promotions.json)`);
}

function pct(x: number): string {
  return (x * 100).toFixed(1) + '%';
}

function printSummary(s: OutcomeScoreSnapshot): void {
  const a = s.aggregatePrLevel;
  log.info(
    `OUTCOME PR-level union: precision ${pct(a.precision)} ` +
      `[${pct(a.precisionWilson.lower)}, ${pct(a.precisionWilson.upper)}] ` +
      `recall ${pct(a.recall)} [${pct(a.recallWilson.lower)}, ${pct(a.recallWilson.upper)}] ` +
      `F1 ${a.f1.toFixed(3)} (TP=${a.truePositive} FP=${a.falsePositive} FN=${a.falseNegative} TN=${a.trueNegative})`,
  );
  log.info(
    `corpus: ${s.corpus.scored} scored (${s.corpus.outcomeBad} bad / ${s.corpus.outcomeClean} clean), ` +
      `${s.corpus.excludedIndeterminate} indeterminate excluded`,
  );
  for (const d of s.perDetector) {
    if (d.findingsTotal === 0 && d.truePositive === 0 && d.falsePositive === 0) continue;
    log.info(
      `  ${d.detector}: PR prec ${pct(d.precision)} [${pct(d.precisionWilson.lower)}, ${pct(d.precisionWilson.upper)}] ` +
        `(TP=${d.truePositive} FP=${d.falsePositive}); finding prec ${pct(d.findingPrecision)} ` +
        `(${d.findingsOnBad}/${d.findingsTotal})`,
    );
  }
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
