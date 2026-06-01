// Calibrates the judge-primary prompt against the injected oracle. For
// each committed prompt version it measures recall on a held-out split of
// the semantic injections and the false-positive rate on a seeded sample
// of presumed-clean real PRs, plus cost and latency. It promotes the
// version with the highest held-out recall whose clean-PR false-positive
// rate stays within 1 percentage point of the most conservative version,
// and writes the Pareto table and rationale.
//
// Split is deterministic (every 5th case by id is held out, an 80/20
// split). Judge calls replay from benchmarks/judge-cache/cache.json.
//
// Usage: node dist/scripts/oracle/calibrate-judge.js [--clean-sample N] [--no-live]

import * as fs from 'fs';
import * as path from 'path';
import {
  buildPrimaryPrompt,
  primarySystemPrompt,
} from '../../src/audit/cheat-detector/llm-judge/anthropic-judge';
import { MAX_JUDGE_DIFF_CHARS } from '../../src/audit/cheat-detector/llm-judge';
import { JUDGE_PROMPT_SETS } from '../../src/audit/cheat-detector/judge-prompts';
import type { SemanticCheatCategory } from '../../src/audit/types';
import { loadDotenv } from '../../src/env-loader';
import {
  loadOracleCorpus,
  loadRealCorpus,
  readRealDiff,
  repoRoot,
  type OracleCase,
} from '../benchmarks/lib/corpora';
import { JudgeCache } from '../benchmarks/lib/judge-cache';
import { BenchJudge, estimateHaikuUsd } from '../benchmarks/lib/judge-client';
import { round, divide, p95, mean } from '../benchmarks/lib/metrics';

const SEMANTIC: SemanticCheatCategory[] = ['goal-not-fixed', 'cheat-mock-mutation'];
const FP_TOLERANCE_PP = 1; // percentage points over the most conservative version

interface VersionResult {
  version: string;
  heldOut: number;
  recall: number;
  cleanSample: number;
  falsePositiveRate: number;
  meanCostUsd: number;
  p95LatencyMs: number;
}

function capDiff(diff: string): string {
  return diff.length <= MAX_JUDGE_DIFF_CHARS ? diff : diff.slice(0, MAX_JUDGE_DIFF_CHARS);
}

function heldOutSemantic(cases: OracleCase[]): OracleCase[] {
  const semantic = cases
    .filter((c) => SEMANTIC.includes(c.category as SemanticCheatCategory))
    .sort((a, b) => a.prId.localeCompare(b.prId));
  // 80/20: every 5th case is held out for evaluation.
  return semantic.filter((_, i) => i % 5 === 0);
}

async function evalVersion(
  version: string,
  heldOut: OracleCase[],
  cleanDiffs: { title: string; diff: string }[],
  judge: BenchJudge,
  allowLive: boolean,
): Promise<VersionResult> {
  const latencies: number[] = [];
  const costs: number[] = [];
  let tp = 0;
  for (const c of heldOut) {
    const category = c.category as SemanticCheatCategory;
    const claim = c.label.claim ?? c.label.prTitle;
    const user = buildPrimaryPrompt(category, claim, capDiff(c.brokenDiff), version);
    const a = await judge.ask(primarySystemPrompt(version), user, allowLive);
    latencies.push(a.latencyMs);
    costs.push(estimateHaikuUsd(a.promptTokens, a.completionTokens));
    if (a.answer === 'yes') tp += 1;
  }
  let falseYes = 0;
  for (const clean of cleanDiffs) {
    let flagged = false;
    for (const category of SEMANTIC) {
      const user = buildPrimaryPrompt(category, clean.title, capDiff(clean.diff), version);
      const a = await judge.ask(primarySystemPrompt(version), user, allowLive);
      latencies.push(a.latencyMs);
      costs.push(estimateHaikuUsd(a.promptTokens, a.completionTokens));
      if (a.answer === 'yes') flagged = true;
    }
    if (flagged) falseYes += 1;
  }
  return {
    version,
    heldOut: heldOut.length,
    recall: round(divide(tp, heldOut.length)),
    cleanSample: cleanDiffs.length,
    falsePositiveRate: round(divide(falseYes, cleanDiffs.length)),
    meanCostUsd: round(mean(costs), 6),
    p95LatencyMs: round(p95(latencies), 1),
  };
}

function select(results: VersionResult[]): { version: string; rationale: string } {
  const minFp = Math.min(...results.map((r) => r.falsePositiveRate));
  const ceiling = minFp + FP_TOLERANCE_PP / 100;
  const eligible = results.filter((r) => r.falsePositiveRate <= ceiling + 1e-9);
  const pool = eligible.length > 0 ? eligible : results;
  const winner = [...pool].sort((a, b) => b.recall - a.recall || a.falsePositiveRate - b.falsePositiveRate)[0];
  if (winner === undefined) return { version: 'v1-conservative', rationale: 'no results' };
  const rationale =
    `Most conservative clean-PR FP rate is ${(minFp * 100).toFixed(1)}%; the ` +
    `eligibility ceiling is +${FP_TOLERANCE_PP}pp (${(ceiling * 100).toFixed(1)}%). ` +
    `Among versions within that ceiling, ${winner.version} has the highest ` +
    `held-out recall (${winner.recall.toFixed(3)}) at FP ` +
    `${(winner.falsePositiveRate * 100).toFixed(1)}%.`;
  return { version: winner.version, rationale };
}

function render(results: VersionResult[], chosen: { version: string; rationale: string }, model: string): string {
  const lines: string[] = [];
  lines.push('# Judge prompt calibration');
  lines.push('');
  lines.push(
    'Each committed prompt version scored on a held-out 20% split of the ' +
      'semantic injections (recall) and a seeded sample of presumed-clean real ' +
      `PRs (false-positive rate), against ${model}. Regenerate with ` +
      '`npm run calibrate:judge`.',
  );
  lines.push('');
  lines.push('| prompt version | held-out | recall | clean sample | FP rate | mean cost/call | p95 latency |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of results) {
    lines.push(
      `| ${r.version} | ${r.heldOut} | ${r.recall.toFixed(3)} | ${r.cleanSample} | ` +
        `${(r.falsePositiveRate * 100).toFixed(1)}% | $${r.meanCostUsd.toFixed(6)} | ${r.p95LatencyMs.toFixed(0)} ms |`,
    );
  }
  lines.push('');
  lines.push('## Selection');
  lines.push('');
  lines.push(`Chosen: **${chosen.version}** (wired as the default).`);
  lines.push('');
  lines.push(chosen.rationale);
  lines.push('');
  lines.push(
    '> The presumed in "presumed-clean" is load-bearing: the FP rate is ' +
      'measured against PRs hand-labeled clean, not provably-clean PRs. Cost is ' +
      'a Haiku list-price estimate from token counts; the run used a local model.',
  );
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const allowLive = !argv.includes('--no-live');
  const sampleArg = argv.indexOf('--clean-sample');
  const cleanSample = sampleArg !== -1 ? Number(argv[sampleArg + 1]) : 30;
  loadDotenv();
  const root = repoRoot();
  const heldOut = heldOutSemantic(loadOracleCorpus(root));
  const { labeled } = await loadRealCorpus(root);
  const clean = labeled
    .filter((e) => e.groundTruth.verdict === 'clean')
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, cleanSample)
    .map((e) => ({ title: e.pr.title, diff: readRealDiff(e, root) }));

  const cache = new JudgeCache(root);
  const judge = new BenchJudge(cache);
  const results: VersionResult[] = [];
  for (const version of Object.keys(JUDGE_PROMPT_SETS)) {
    results.push(await evalVersion(version, heldOut, clean, judge, allowLive));
  }
  cache.flush();
  const chosen = select(results);

  const outDir = path.join(root, 'benchmarks', 'oracle-corpus');
  fs.writeFileSync(path.join(outDir, 'judge-calibration.md'), render(results, chosen, judge.config().model));

  process.stdout.write(
    `calibrate-judge: ${results
      .map((r) => `${r.version}(R=${r.recall},FP=${r.falsePositiveRate})`)
      .join(' ')} -> chose ${chosen.version}\n`,
  );
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(`calibrate-judge: ${(err as Error).message}\n`);
    process.exitCode = 1;
  });
}

export { main };
