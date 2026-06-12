// Adaptive-evasion harness. For each injected structural defect it layers
// the evader stack at increasing depth and records whether the detector
// still fires, producing a per-category survival curve (detection rate vs
// evasion depth). Deterministic: detectors only, no judge.
//
// Outputs:
//   benchmarks/oracle-corpus/evasion-report.md
//   benchmarks/oracle-corpus/evasion-data.csv
//
// Usage: node dist/scripts/oracle/run-evasion.js [--per-category N]

import * as fs from 'fs';
import * as path from 'path';
import { runCheatDetectors } from '../../src/audit/cheat-detector';
import { catchPathFor } from '../../src/audit/oracle/category-map';
import {
  EVADERS,
  applyStack,
  BEHAVIORAL_EVADERS,
  BEHAVIORAL_MAX_DEPTH,
  applyBehavioralStack,
} from '../../src/audit/oracle/evade/evaders';
import { focusSemanticDiff } from '../../src/audit/cheat-detector/mock-delta';
import {
  buildPrimaryPrompt,
  primarySystemPrompt,
} from '../../src/audit/cheat-detector/llm-judge/anthropic-judge';
import { MAX_JUDGE_DIFF_CHARS } from '../../src/audit/cheat-detector/llm-judge';
import type { CheatCategory, SemanticCheatCategory } from '../../src/audit/types';
import { loadDotenv } from '../../src/env-loader';
import { loadOracleCorpus, repoRoot, type OracleCase } from '../benchmarks/lib/corpora';
import { JudgeCache } from '../benchmarks/lib/judge-cache';
import { BenchJudge } from '../benchmarks/lib/judge-client';
import { round, divide } from '../benchmarks/lib/metrics';

const MAX_DEPTH = EVADERS.length;
const SEMANTIC_CATEGORIES: SemanticCheatCategory[] = ['goal-not-fixed', 'cheat-mock-mutation'];

function capDiff(diff: string): string {
  return diff.length <= MAX_JUDGE_DIFF_CHARS ? diff : diff.slice(0, MAX_JUDGE_DIFF_CHARS);
}

interface SemanticRow {
  category: string;
  depth: number;
  detected: number;
  total: number;
  rate: number;
}

// Survival of the focused judge path under evasion. For cheat-mock-mutation the
// behavioral evaders (method alias, decoy mock) are the real adaptive attack;
// the cosmetic stack (especially the noise file) is the needle-in-haystack
// attack the focus is built to neutralize. goal-not-fixed reads the whole diff,
// so only the cosmetic stack applies to it.
async function scoreSemanticEvasion(
  cases: OracleCase[],
  judge: BenchJudge,
  perCategory: number,
  allowLive: boolean,
): Promise<SemanticRow[]> {
  const rows: SemanticRow[] = [];
  for (const category of SEMANTIC_CATEGORIES) {
    const subset = cases.filter((c) => c.category === category).slice(0, perCategory);
    if (subset.length === 0) continue;
    const maxDepth = category === 'cheat-mock-mutation' ? BEHAVIORAL_MAX_DEPTH : MAX_DEPTH;
    for (let depth = 0; depth <= maxDepth; depth += 1) {
      let detected = 0;
      for (const c of subset) {
        const mutated =
          category === 'cheat-mock-mutation'
            ? applyBehavioralStack(c.brokenDiff, depth)
            : applyStack(c.brokenDiff, depth);
        const focus = focusSemanticDiff(category, mutated);
        if (focus.skip) continue;
        const claim = c.label.claim ?? c.label.prTitle;
        const user = buildPrimaryPrompt(category, claim, capDiff(focus.diff));
        const a = await judge.ask(primarySystemPrompt(), user, allowLive);
        if (a.answer === 'yes') detected += 1;
      }
      rows.push({
        category,
        depth,
        detected,
        total: subset.length,
        rate: round(divide(detected, subset.length)),
      });
    }
  }
  return rows;
}

function renderSemantic(rows: SemanticRow[], judgeModel: string): string[] {
  const lines: string[] = [];
  lines.push('## Behavioral evasion (semantic categories)');
  lines.push('');
  lines.push(
    'The focused-judge path (cheat-mock-mutation) and the whole-diff judge ' +
      '(goal-not-fixed) re-run under evasion. cheat-mock-mutation layers the ' +
      'cosmetic stack then the behavioral evaders (' +
      BEHAVIORAL_EVADERS.map((e) => e.id).join(', ') +
      `); goal-not-fixed layers the cosmetic stack only. Cells are judge ` +
      `detection rate against ${judgeModel}.`,
  );
  lines.push('');
  const header = ['category', ...Array.from({ length: BEHAVIORAL_MAX_DEPTH + 1 }, (_, d) => `d${d}`)];
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`|${header.map(() => '---').join('|')}|`);
  for (const category of SEMANTIC_CATEGORIES) {
    const cells: string[] = [category];
    for (let depth = 0; depth <= BEHAVIORAL_MAX_DEPTH; depth += 1) {
      const r = rows.find((x) => x.category === category && x.depth === depth);
      cells.push(r ? r.rate.toFixed(2) : '-');
    }
    lines.push(`| ${cells.join(' | ')} |`);
  }
  lines.push('');
  lines.push(
    '> cheat-mock-mutation stays flat under the cosmetic stack because the ' +
      'focus discards the noise file and judges only the mock hunk, and under ' +
      'the behavioral evaders because the focus matches the whole ' +
      'mockReturnValue/mockImplementation family, not one spelling. A `-` is a ' +
      'depth that does not apply to that category (the behavioral evaders are ' +
      'no-ops on goal-not-fixed).',
  );
  lines.push('');
  return lines;
}

async function detects(diff: string, root: string, detector: CheatCategory): Promise<boolean> {
  const result = await runCheatDetectors({ unifiedDiff: diff, repoRoot: root, detectorSet: 'experimental' });
  return result.findings.some((f) => f.category === detector);
}

interface Row {
  category: string;
  depth: number;
  detected: number;
  total: number;
  rate: number;
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const perArg = argv.indexOf('--per-category');
  const perCategory = perArg !== -1 ? Number(argv[perArg + 1]) : 8;
  const semArg = argv.indexOf('--semantic-per-category');
  const semanticPerCategory = semArg !== -1 ? Number(argv[semArg + 1]) : 5;
  const runJudge = !argv.includes('--no-judge');
  const allowLive = !argv.includes('--no-live');
  loadDotenv();
  const root = repoRoot();
  const allCases = loadOracleCorpus(root);
  const cases = allCases.filter((c) => catchPathFor(c.category as never).kind === 'detector');

  const byCategory = new Map<string, OracleCase[]>();
  for (const c of cases) {
    const list = byCategory.get(c.category) ?? [];
    if (list.length < perCategory) list.push(c);
    byCategory.set(c.category, list);
  }

  const rows: Row[] = [];
  for (const [category, subset] of [...byCategory.entries()].sort()) {
    const detector = (catchPathFor(category as never) as { detector: CheatCategory }).detector;
    for (let depth = 0; depth <= MAX_DEPTH; depth += 1) {
      let detected = 0;
      for (const c of subset) {
        const mutated = applyStack(c.brokenDiff, depth);
        if (await detects(mutated, root, detector)) detected += 1;
      }
      rows.push({ category, depth, detected, total: subset.length, rate: round(divide(detected, subset.length)) });
    }
  }

  // Semantic (judge-path) survival, including the behavioral evaders.
  const cache = new JudgeCache(root);
  const judge = new BenchJudge(cache);
  const semanticRows = runJudge
    ? await scoreSemanticEvasion(allCases, judge, semanticPerCategory, allowLive)
    : [];
  cache.flush();

  // CSV
  const csv = ['category,depth,detected,total,detection_rate'];
  for (const r of rows) csv.push(`${r.category},${r.depth},${r.detected},${r.total},${r.rate}`);
  for (const r of semanticRows)
    csv.push(`${r.category},${r.depth},${r.detected},${r.total},${r.rate}`);
  fs.writeFileSync(path.join(root, 'benchmarks', 'oracle-corpus', 'evasion-data.csv'), `${csv.join('\n')}\n`);

  // MD survival table: category x depth.
  const categories = [...byCategory.keys()].sort();
  const lines: string[] = [];
  lines.push('# Evasion survival curves');
  lines.push('');
  lines.push(
    `Each injected structural defect was mutated by the evader stack at ` +
      `increasing depth (0 = unmodified, ${MAX_DEPTH} = all evaders), and the ` +
      'detector re-run. The cells are detection rate (1.0 = still caught). ' +
      'Evaders: ' +
      EVADERS.map((e) => e.id).join(', ') +
      '. Regenerate with `node dist/scripts/oracle/run-evasion.js`.',
  );
  lines.push('');
  const header = ['detector', ...Array.from({ length: MAX_DEPTH + 1 }, (_, d) => `d${d}`)];
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`|${header.map(() => '---').join('|')}|`);
  for (const category of categories) {
    const cells = [category];
    for (let depth = 0; depth <= MAX_DEPTH; depth += 1) {
      const r = rows.find((x) => x.category === category && x.depth === depth);
      cells.push(r ? r.rate.toFixed(2) : '-');
    }
    lines.push(`| ${cells.join(' | ')} |`);
  }
  lines.push('');
  lines.push(
    '> A flat row means the evader stack does not reduce detection: every ' +
      'detector here is robust to these cosmetic mutations (identifier rename, ' +
      'whitespace, line reorder, noise file). A row below 1.00 that stays flat ' +
      '(assertion-strip, test-relaxation) reflects base recall on non-JS carrier ' +
      'files, not an evasion success, since the rate does not fall as depth ' +
      'rises. A dropping row would show the depth at which evasion succeeds. The ' +
      'underlying counts are in evasion-data.csv. These evaders are ' +
      'structure-preserving; semantic-rewrite evaders are the next escalation.',
  );
  lines.push('');
  if (semanticRows.length > 0) {
    lines.push(...renderSemantic(semanticRows, judge.config().model));
  }
  fs.writeFileSync(path.join(root, 'benchmarks', 'oracle-corpus', 'evasion-report.md'), `${lines.join('\n')}\n`);

  const dropped = rows.filter((r) => r.depth === MAX_DEPTH && r.rate < 1).map((r) => r.category);
  const semSurvival = SEMANTIC_CATEGORIES.map((cat) => {
    const deepest = semanticRows.filter((r) => r.category === cat);
    const last = deepest[deepest.length - 1];
    return `${cat}:${last ? last.rate : 'n/a'}`;
  }).join(', ');
  process.stdout.write(
    `run-evasion: detectors=${categories.length} per-category=${perCategory} ` +
      `evaded-at-max-depth=[${[...new Set(dropped)].join(', ')}] ` +
      `semantic-survival-at-max-depth=[${semSurvival}]\n`,
  );
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(`run-evasion: ${(err as Error).message}\n`);
    process.exitCode = 1;
  });
}

export { main };
