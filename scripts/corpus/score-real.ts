// Scores the labeled real-PR corpus against the v10 cheat-detector
// registry. Runs every detector on every labeled entry's vendored
// diff, projects `brokenCategories` onto detector categories, and
// computes per-detector precision / recall / F1.
//
// Output: `benchmarks/real-corpus/scores/<UTC-timestamp>.json` (one
// snapshot per run) and `benchmarks/real-corpus/scores/latest.json`
// (always overwritten — convenience symlink alternative for the
// leaderboard renderer).
//
// `ambiguous`-verdict entries are excluded from precision/recall
// arithmetic; they are reported in the snapshot for transparency but
// would only add noise to the headline number.

import * as fs from 'fs/promises';
import * as path from 'path';
import { runCheatDetectors } from '../../src/audit/cheat-detector';
import type { CheatCategory } from '../../src/audit/types';
import { loadPrCorpus, loadLabeledPrEntries } from '../../benchmarks/real-corpus/loader';
import type { BrokenCategory, PrCorpusEntry } from '../../benchmarks/real-corpus/schema';
import { findRepoRoot } from './repo-root';
import { loadDotenv } from '../../src/env-loader';

interface ScoreArgs {
  rawDir: string;
  labelsDir: string;
  outDir: string;
  repoRoot: string;
  judgeEnabled: boolean;
}

interface PerDetectorScore {
  detector: CheatCategory;
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  precision: number;
  recall: number;
  f1: number;
}

interface AggregateScore {
  /** Per-entry "any blocking finding fired" against "any broken verdict". */
  overallPrecision: number;
  overallRecall: number;
  overallF1: number;
  totalLabeled: number;
  totalScored: number;
  totalAmbiguousExcluded: number;
  totalCleanLabeled: number;
  totalBrokenLabeled: number;
}

interface ScoreSnapshot {
  generatedAt: string;
  rawDir: string;
  labelsDir: string;
  detectorVersions: Record<string, string>;
  perDetector: PerDetectorScore[];
  aggregate: AggregateScore;
  unlabeledIds: string[];
  invalidLabelIds: { id: string; issues: string[] }[];
}

/**
 * Maps a label-level `BrokenCategory` to the set of detector categories
 * that *should* fire on the entry. Many-to-many on purpose: a single
 * label can satisfy more than one detector (e.g., `cheat-test-modification`
 * covers both `test-relaxation` and `assertion-strip`).
 *
 * Categories not present here (e.g., `concurrency-defect`,
 * `resource-leak`) do not map to any v10 detector; entries labeled with
 * those alone are scored as "broken but not in any detector's wheelhouse"
 * and so contribute to overall recall but not to any per-detector recall.
 */
const BROKEN_TO_DETECTOR: Record<BrokenCategory, readonly CheatCategory[]> = {
  'goal-not-fixed': ['no-op-fix', 'comment-only-fix'],
  regression: ['fake-refactor'],
  'cheat-hardcoded-answer': ['no-op-fix'],
  // cheat-exception-swallowing maps to error-swallow only; the
  // exception-rethrow-lost-context detector targets a structurally
  // different pattern (throw err → throw new Error without cause),
  // not catch-and-discard. Mapping both would manufacture FNs for
  // whichever detector didn't fire on each labeled entry.
  'cheat-exception-swallowing': ['error-swallow'],
  'cheat-test-modification': ['test-relaxation', 'assertion-strip'],
  'cheat-mock-mutation': ['mock-of-hallucination'],
  'edge-case-failure': ['dead-branch-insertion'],
  'under-tested': ['coverage-erosion'],
  'type-flow-defect': [],
  'concurrency-defect': [],
  'resource-leak': [],
};

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

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  if (args.judgeEnabled) {
    // Load ANTHROPIC_API_KEY from the project/install/home .env chain so
    // the judged scoring path works without exporting the key by hand.
    loadDotenv();
  }
  const entries = await loadPrCorpus(args.rawDir);
  const loaded = await loadLabeledPrEntries(entries, args.labelsDir);
  const snapshot = await scoreEntries(loaded.labeled, args);
  snapshot.unlabeledIds = loaded.unlabeledIds;
  snapshot.invalidLabelIds = loaded.invalidIds;
  await writeSnapshot(snapshot, args.outDir, args.repoRoot);
  printSummary(snapshot);
}

async function scoreEntries(
  labeled: readonly PrCorpusEntry[],
  args: ScoreArgs,
): Promise<ScoreSnapshot> {
  const perDetectorCounts = new Map<CheatCategory, {
    tp: number;
    fp: number;
    tn: number;
    fn: number;
  }>();
  for (const cat of ALL_DETECTOR_CATEGORIES) {
    perDetectorCounts.set(cat, { tp: 0, fp: 0, tn: 0, fn: 0 });
  }
  let detectorVersions: Record<string, string> = {};
  let totalAmbiguous = 0;
  let totalClean = 0;
  let totalBroken = 0;
  let overallTp = 0;
  let overallFp = 0;
  let overallFn = 0;
  let overallTn = 0;

  for (const entry of labeled) {
    if (entry.groundTruth.verdict === 'ambiguous') {
      totalAmbiguous += 1;
      continue;
    }
    const diff = await readVendoredDiff(args.rawDir, entry);
    // Pass PR metadata so the PR-intent layer fires during scoring.
    // Otherwise findings stay at their detector-emitted severity and
    // any escalation the audit would do in production (warn→block when
    // the PR claims a fix) is invisible to the leaderboard.
    const result = await runCheatDetectors({
      unifiedDiff: diff,
      repoRoot: args.repoRoot,
      // v10.2-advisory split detectors into default + experimental.
      // The scorer needs the full set so it can keep producing the
      // per-detector TP/FP table for the retired six as well, which
      // is the data the promotion script reads.
      detectorSet: 'experimental',
      // Opt-in judge confirmation gate. Off unless SWARM_AUDIT_LLM_JUDGE=1
      // and a key is loaded, so the default scored path stays
      // deterministic and free. When on, the gate downgrades blocks the
      // judge refutes, which is exactly the precision question we want
      // measured against the labeled corpus.
      judgeEnabled: args.judgeEnabled,
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
    if (Object.keys(detectorVersions).length === 0) {
      detectorVersions = result.detectorVersions;
    }
    const firedCategories = new Set<CheatCategory>();
    for (const f of result.findings) {
      if (f.severity === 'block') firedCategories.add(f.category);
    }
    const isBroken = entry.groundTruth.verdict === 'broken';
    if (isBroken) totalBroken += 1;
    else totalClean += 1;
    const expectedCategories = isBroken ? expectedDetectorsFor(entry) : new Set<CheatCategory>();
    for (const cat of ALL_DETECTOR_CATEGORIES) {
      const fired = firedCategories.has(cat);
      const expected = expectedCategories.has(cat);
      const bucket = perDetectorCounts.get(cat);
      if (bucket === undefined) continue;
      if (fired && expected) bucket.tp += 1;
      else if (fired && !expected) bucket.fp += 1;
      else if (!fired && expected) bucket.fn += 1;
      else bucket.tn += 1;
    }
    const anyFired = firedCategories.size > 0;
    if (isBroken && anyFired) overallTp += 1;
    else if (isBroken && !anyFired) overallFn += 1;
    else if (!isBroken && anyFired) overallFp += 1;
    else overallTn += 1;
  }

  const perDetector: PerDetectorScore[] = ALL_DETECTOR_CATEGORIES.map((cat) => {
    const c = perDetectorCounts.get(cat) ?? { tp: 0, fp: 0, tn: 0, fn: 0 };
    return {
      detector: cat,
      truePositive: c.tp,
      falsePositive: c.fp,
      trueNegative: c.tn,
      falseNegative: c.fn,
      precision: divide(c.tp, c.tp + c.fp),
      recall: divide(c.tp, c.tp + c.fn),
      f1: f1Of(c.tp, c.fp, c.fn),
    };
  });

  const aggregate: AggregateScore = {
    overallPrecision: divide(overallTp, overallTp + overallFp),
    overallRecall: divide(overallTp, overallTp + overallFn),
    overallF1: f1Of(overallTp, overallFp, overallFn),
    totalLabeled: labeled.length,
    totalScored: labeled.length - totalAmbiguous,
    totalAmbiguousExcluded: totalAmbiguous,
    totalCleanLabeled: totalClean,
    totalBrokenLabeled: totalBroken,
  };
  void overallTn;
  return {
    generatedAt: new Date().toISOString(),
    rawDir: args.rawDir,
    labelsDir: args.labelsDir,
    detectorVersions,
    perDetector,
    aggregate,
    unlabeledIds: [],
    invalidLabelIds: [],
  };
}

function expectedDetectorsFor(entry: PrCorpusEntry): Set<CheatCategory> {
  const set = new Set<CheatCategory>();
  for (const cat of entry.groundTruth.brokenCategories ?? []) {
    for (const detector of BROKEN_TO_DETECTOR[cat] ?? []) {
      set.add(detector);
    }
  }
  return set;
}

async function readVendoredDiff(rawDir: string, entry: PrCorpusEntry): Promise<string> {
  const diskPath = path.join(rawDir, entry.vendoredDiffPath);
  return fs.readFile(diskPath, 'utf8');
}

function divide(num: number, den: number): number {
  return den === 0 ? 0 : num / den;
}

function f1Of(tp: number, fp: number, fn: number): number {
  const precision = divide(tp, tp + fp);
  const recall = divide(tp, tp + fn);
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

async function writeSnapshot(
  snapshot: ScoreSnapshot,
  outDir: string,
  repoRoot: string,
): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });
  const stamp = snapshot.generatedAt.replace(/[:.]/g, '-');
  const fileName = `${stamp}.json`;
  const text = `${JSON.stringify(snapshot, null, 2)}\n`;
  await fs.writeFile(path.join(outDir, fileName), text, 'utf8');
  await fs.writeFile(path.join(outDir, 'latest.json'), text, 'utf8');
  // Also publish to the docs site so the leaderboard renderer can show
  // the v10.1 real-corpus numbers alongside the synthetic scores.
  const siteDir = path.join(repoRoot, 'docs', 'leaderboard');
  await fs.mkdir(siteDir, { recursive: true });
  await fs.writeFile(path.join(siteDir, 'real-baseline.json'), text, 'utf8');
}

function printSummary(snapshot: ScoreSnapshot): void {
  process.stdout.write(
    `score-real: scored=${snapshot.aggregate.totalScored} ` +
      `broken=${snapshot.aggregate.totalBrokenLabeled} ` +
      `clean=${snapshot.aggregate.totalCleanLabeled} ` +
      `ambiguous-excluded=${snapshot.aggregate.totalAmbiguousExcluded} ` +
      `overallP=${snapshot.aggregate.overallPrecision.toFixed(3)} ` +
      `overallR=${snapshot.aggregate.overallRecall.toFixed(3)} ` +
      `overallF1=${snapshot.aggregate.overallF1.toFixed(3)}\n`,
  );
}

function parseArgs(argv: string[]): ScoreArgs {
  const repoRoot = findRepoRoot(__dirname);
  const defaults: ScoreArgs = {
    rawDir: path.join(repoRoot, 'benchmarks', 'real-corpus', 'raw'),
    labelsDir: path.join(repoRoot, 'benchmarks', 'real-corpus', 'labels'),
    outDir: path.join(repoRoot, 'benchmarks', 'real-corpus', 'scores'),
    repoRoot,
    judgeEnabled: process.env.SWARM_AUDIT_LLM_JUDGE === '1',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--judge') {
      defaults.judgeEnabled = true;
    } else if (arg === '--raw-dir') {
      defaults.rawDir = path.resolve(requireValue(argv, (i += 1), '--raw-dir'));
    } else if (arg === '--labels-dir') {
      defaults.labelsDir = path.resolve(requireValue(argv, (i += 1), '--labels-dir'));
    } else if (arg === '--out-dir') {
      defaults.outDir = path.resolve(requireValue(argv, (i += 1), '--out-dir'));
    } else if (arg === '--repo-root') {
      defaults.repoRoot = path.resolve(requireValue(argv, (i += 1), '--repo-root'));
    } else {
      throw new Error(`score-real: unknown argument "${arg ?? ''}"`);
    }
  }
  return defaults;
}

function requireValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`score-real: ${option} requires a value`);
  }
  return value;
}

export {
  BROKEN_TO_DETECTOR,
  ALL_DETECTOR_CATEGORIES,
  scoreEntries,
  expectedDetectorsFor,
};

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(`score-real: ${(err as Error).message}\n`);
    process.exitCode = 1;
  });
}
