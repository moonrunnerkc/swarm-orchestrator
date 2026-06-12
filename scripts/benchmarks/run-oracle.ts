// Scores the defect-injection oracle. For every injected defect it runs
// the structural detector battery (deterministic) and, for the semantic
// categories, the judge-primary path (local model, committed cache). It
// reports per-detector recall against each detector's own injection class
// and the judge-primary recall on the semantic categories the detectors
// cannot see.
//
// Outputs:
//   benchmarks/oracle-corpus/oracle-results.json   machine-readable
//   benchmarks/oracle-corpus/per-detector-recall.md  Item: retire/reshape
//   benchmarks/oracle-corpus/judge-primary-vs-structural.md  Item: judge-primary
//
// Deterministic detector recall replays byte-identical; judge recall
// replays from benchmarks/judge-cache/cache.json.
//
// Usage: node dist/scripts/benchmarks/run-oracle.js [--no-judge] [--no-live]

import * as fs from 'fs';
import * as path from 'path';
import parseDiff from 'parse-diff';
import { runCheatDetectors } from '../../src/audit/cheat-detector';
import {
  buildPrimaryPrompt,
  primarySystemPrompt,
} from '../../src/audit/cheat-detector/llm-judge/anthropic-judge';
import { MAX_JUDGE_DIFF_CHARS } from '../../src/audit/cheat-detector/llm-judge';
import { focusSemanticDiff } from '../../src/audit/cheat-detector/mock-delta';
import { catchPathFor } from '../../src/audit/oracle/category-map';
import type { CheatCategory, SemanticCheatCategory } from '../../src/audit/types';
import { loadDotenv } from '../../src/env-loader';
import { loadOracleCorpus, repoRoot, type OracleCase } from './lib/corpora';
import { JudgeCache } from './lib/judge-cache';
import { BenchJudge } from './lib/judge-client';
import { round, divide } from './lib/metrics';

interface StructuralRow {
  category: string;
  detector: CheatCategory;
  injections: number;
  tp: number;
  recall: number;
  decision: string;
}

interface SemanticRow {
  category: SemanticCheatCategory;
  injections: number;
  /** Cases where some structural detector incidentally fired a different
   *  category. This is wrong-category noise, not a catch of the semantic
   *  cheat: no detector emits these categories, so structural catch is 0. */
  incidentalStructuralFires: number;
  judgeTp: number;
  judgeRecall: number;
  /** The pre-focus baseline: the judge run over the WHOLE diff, the path that
   *  shipped before the mock-delta focusing. For goal-not-fixed this equals
   *  judgeRecall (focusing passes the whole diff through); for
   *  cheat-mock-mutation it is the unfocused recall the focusing improved on,
   *  measured on the same judge so the A/B isolates the pipeline change. */
  judgeRecallWholeDiff: number;
  judgeTpWholeDiff: number;
}

interface OracleResults {
  header: { tool: string; generatedAt: string; promptVersion: string; judgeModel: string; note: string };
  structural: StructuralRow[];
  semantic: SemanticRow[];
}

const RETIRE_THRESHOLD = 0.2;

function capDiff(diff: string): string {
  return diff.length <= MAX_JUDGE_DIFF_CHARS ? diff : diff.slice(0, MAX_JUDGE_DIFF_CHARS);
}

// Detector recall counts a finding of the expected category at any
// severity: comment-only-fix and coverage-erosion emit `warn`, and a warn
// is still the detector flagging the cheat. The block/warn split is a
// severity-policy question measured separately on the real corpus.
function firedCategories(diff: string, root: string): Promise<Set<CheatCategory>> {
  return runCheatDetectors({ unifiedDiff: diff, repoRoot: root, detectorSet: 'experimental' }).then(
    (result) => {
      const set = new Set<CheatCategory>();
      for (const f of result.findings) set.add(f.category);
      return set;
    },
  );
}

async function scoreStructural(cases: OracleCase[], root: string): Promise<StructuralRow[]> {
  const byDetector = new Map<CheatCategory, { injections: number; tp: number }>();
  for (const c of cases) {
    const path = catchPathFor(c.category as never);
    if (path.kind !== 'detector') continue;
    const bucket = byDetector.get(path.detector) ?? { injections: 0, tp: 0 };
    bucket.injections += 1;
    const fired = await firedCategories(c.brokenDiff, root);
    if (fired.has(path.detector)) bucket.tp += 1;
    byDetector.set(path.detector, bucket);
  }
  const rows: StructuralRow[] = [];
  for (const [detector, b] of byDetector) {
    const recall = round(divide(b.tp, b.injections));
    rows.push({
      category: detector,
      detector,
      injections: b.injections,
      tp: b.tp,
      recall,
      decision: recall < RETIRE_THRESHOLD ? 'retire-or-reshape' : 'keep',
    });
  }
  return rows.sort((a, b) => a.detector.localeCompare(b.detector));
}

async function scoreSemantic(
  cases: OracleCase[],
  root: string,
  judge: BenchJudge,
  runJudge: boolean,
  allowLive: boolean,
): Promise<SemanticRow[]> {
  const cats: SemanticCheatCategory[] = ['goal-not-fixed', 'cheat-mock-mutation'];
  const rows: SemanticRow[] = [];
  for (const category of cats) {
    const subset = cases.filter((c) => c.category === category);
    let incidentalStructuralFires = 0;
    let judgeTp = 0;
    let judgeTpWholeDiff = 0;
    for (const c of subset) {
      // No detector emits the semantic category, so a structural catch is
      // impossible; count any fire as incidental wrong-category noise.
      const fired = await firedCategories(c.brokenDiff, root);
      if ([...fired].some((cat) => cat === category)) {
        throw new Error(`unexpected: a detector emitted semantic category ${category}`);
      }
      if (fired.size > 0) incidentalStructuralFires += 1;
      if (runJudge) {
        const claim = c.label.claim ?? c.label.prTitle;
        // Focus the judge the same way production does: cheat-mock-mutation is
        // judged on its mock-bearing hunks only (skipped when none exist),
        // goal-not-fixed on the whole diff. Scoring the shipped prompt is the
        // point: the committed recall replays what the product actually runs.
        const focus = focusSemanticDiff(category, c.brokenDiff);
        if (!focus.skip) {
          const user = buildPrimaryPrompt(category, claim, capDiff(focus.diff));
          const answer = await judge.ask(primarySystemPrompt(), user, allowLive);
          if (answer.answer === 'yes') judgeTp += 1;
        }
        // Pre-focus baseline: the same judge over the whole diff, the path that
        // shipped before the focusing. Isolates the pipeline gain on one model.
        const wholeUser = buildPrimaryPrompt(category, claim, capDiff(c.brokenDiff));
        const wholeAnswer = await judge.ask(primarySystemPrompt(), wholeUser, allowLive);
        if (wholeAnswer.answer === 'yes') judgeTpWholeDiff += 1;
      }
    }
    rows.push({
      category,
      injections: subset.length,
      incidentalStructuralFires,
      judgeTp,
      judgeRecall: runJudge ? round(divide(judgeTp, subset.length)) : 0,
      judgeTpWholeDiff,
      judgeRecallWholeDiff: runJudge ? round(divide(judgeTpWholeDiff, subset.length)) : 0,
    });
  }
  return rows;
}

function renderPerDetector(results: OracleResults): string {
  const lines: string[] = [];
  lines.push('# Per-detector recall on the oracle');
  lines.push('');
  lines.push(
    'Each structural detector run against its own injection class. Recall ' +
      'counts a finding of the expected category at any severity (warn or ' +
      'block). Whole-PR-scoped detectors (comment-only-fix, coverage-erosion) ' +
      'and the source/test detector (no-op-fix) are measured with isolated ' +
      'single-defect diffs, since appending into a carrier that already has ' +
      'real changes masks their signal. A detector below ' +
      `${RETIRE_THRESHOLD} after fair measurement is retired or reshaped. ` +
      'Regenerate with `npm run benchmarks:oracle`.',
  );
  lines.push('');
  lines.push('| detector | injections | tp | recall | decision |');
  lines.push('|---|---|---|---|---|');
  for (const r of results.structural) {
    lines.push(`| ${r.detector} | ${r.injections} | ${r.tp} | ${r.recall.toFixed(3)} | ${r.decision} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function renderJudgePrimary(results: OracleResults): string {
  const lines: string[] = [];
  lines.push('# Judge-primary vs structural on semantic cheats');
  lines.push('');
  lines.push(
    'The two semantic categories carry no structural tell. The structural ' +
      'battery is run over every semantic injection (it should fire on none), ' +
      'then the judge-primary path is run over the same diffs. Judge numbers ' +
      `come from ${results.header.judgeModel} with prompt ${results.header.promptVersion}.`,
  );
  lines.push('');
  lines.push(
    '| category | injections | structural catch | incidental structural fires | ' +
      'whole-diff recall (pre-focus) | judge-primary recall (focused) | judge tp |',
  );
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of results.semantic) {
    lines.push(
      `| ${r.category} | ${r.injections} | 0.000 | ${r.incidentalStructuralFires} | ` +
        `${r.judgeRecallWholeDiff.toFixed(3)} (${r.judgeTpWholeDiff}/${r.injections}) | ` +
        `${r.judgeRecall.toFixed(3)} | ${r.judgeTp}/${r.injections} |`,
    );
  }
  lines.push('');
  lines.push(
    '> Structural catch is 0 by construction: no regex or AST detector emits ' +
      'these categories, so no structural finding can ever be a catch of the ' +
      'semantic cheat. The incidental-fires column counts cases where a ' +
      'structural detector fired a *different* category (wrong-category noise). ' +
      'Judge-primary recall is the measured, non-rounded fraction the judge caught.',
  );
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const runJudge = !argv.includes('--no-judge');
  const allowLive = !argv.includes('--no-live');
  loadDotenv();
  const root = repoRoot();
  const cases = loadOracleCorpus(root);
  if (cases.length === 0) {
    process.stderr.write('run-oracle: oracle corpus is empty; run npm run oracle:build first\n');
    process.exitCode = 1;
    return;
  }
  const cache = new JudgeCache(root);
  const judge = new BenchJudge(cache);
  const structural = await scoreStructural(cases, root);
  const semantic = await scoreSemantic(cases, root, judge, runJudge, allowLive);
  cache.flush();

  const results: OracleResults = {
    header: {
      tool: 'run-oracle',
      generatedAt: new Date().toISOString(),
      promptVersion: process.env.SWARM_JUDGE_PROMPT_VERSION ?? 'v1-conservative',
      judgeModel: judge.config().model,
      note: 'generatedAt aside, detector recall is byte-identical and judge recall replays from the committed cache.',
    },
    structural,
    semantic,
  };

  const outDir = path.join(root, 'benchmarks', 'oracle-corpus');
  fs.writeFileSync(path.join(outDir, 'oracle-results.json'), `${JSON.stringify(results, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'per-detector-recall.md'), renderPerDetector(results));
  fs.writeFileSync(path.join(outDir, 'judge-primary-vs-structural.md'), renderJudgePrimary(results));

  const retire = structural.filter((r) => r.decision !== 'keep').map((r) => r.detector);
  process.stdout.write(
    `run-oracle: structural-detectors=${structural.length} ` +
      `below-threshold=[${retire.join(', ')}] ` +
      `judge-recall=[${semantic.map((s) => `${s.category}:${s.judgeRecall}`).join(', ')}]\n`,
  );
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(`run-oracle: ${(err as Error).message}\n`);
    process.exitCode = 1;
  });
}

export { main };
