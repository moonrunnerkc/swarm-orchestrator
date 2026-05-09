/* eslint-disable no-console */
/**
 * Phase 5 §8 deterministic-floor cost benchmark.
 *
 * Compares baseline (no `wasmRuntime`) against deterministic
 * (`createDefaultRuntime()`) for a small suite of boilerplate-heavy
 * goals. Two ship-gate booleans are reported and (by default) enforced:
 *
 *   - **§8 (a)**: every tagged obligation in the deterministic
 *     configuration consumes zero candidate-recorded entries.
 *   - **§8 (b)**: deterministic effective input is strictly lower than
 *     baseline effective input on every goal whose deterministic share
 *     is non-zero.
 *
 * Output: `docs/v8-phase-5-benchmark.md` plus appended rows in
 * `docs/benchmarks/v8-history.jsonl`.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  DETERMINISTIC_GOALS,
  assertDeterministicGoalsShape,
} from './deterministic-goals';
import {
  runDeterministicGoal,
  type DeterministicRunResult,
} from './run-deterministic';

interface CliFlags {
  outDir: string;
  jsonl: string;
  refuseOnFailure: boolean;
}

interface ComparisonRow {
  goalId: string;
  obligationCount: number;
  expectedDeterministic: number;
  baseline: DeterministicRunResult;
  deterministic: DeterministicRunResult;
  /** baseline.effectiveInput / deterministic.effectiveInput; >1 means deterministic saves. */
  costSavingsRatio: number;
  /** Tagged obligations whose synthesis was avoided. */
  candidatesAvoided: number;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    outDir: path.resolve('docs'),
    jsonl: path.resolve('docs/benchmarks/v8-history.jsonl'),
    refuseOnFailure: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    if (a === '--out-dir') {
      flags.outDir = path.resolve(argv[++i] ?? '');
    } else if (a === '--jsonl') {
      flags.jsonl = path.resolve(argv[++i] ?? '');
    } else if (a === '--no-refuse') {
      flags.refuseOnFailure = false;
    } else if (a === '--help' || a === '-h') {
      process.stderr.write(
        [
          'usage: node dist/scripts/v8-bench/run-phase5.js [flags]',
          '',
          '  --out-dir <dir>    where to write the markdown report (default ./docs)',
          '  --jsonl <path>     JSONL history append path',
          '  --no-refuse        do not exit non-zero when the §8 gates fail',
          '  --help, -h         show this message',
          '',
        ].join('\n'),
      );
      process.exit(0);
    } else {
      throw new Error(`unknown flag: ${a}`);
    }
  }
  return flags;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  assertDeterministicGoalsShape();

  const rows: ComparisonRow[] = [];
  for (const goal of DETERMINISTIC_GOALS) {
    const baseline = await runDeterministicGoal(goal, {
      mode: 'single',
      deterministic: false,
    });
    const deterministic = await runDeterministicGoal(goal, {
      mode: 'single',
      deterministic: true,
    });
    const ratio =
      deterministic.effectiveInput === 0
        ? Infinity
        : baseline.effectiveInput / Math.max(deterministic.effectiveInput, 1);
    rows.push({
      goalId: goal.id,
      obligationCount: goal.obligations.length,
      expectedDeterministic: goal.expectedDeterministic,
      baseline,
      deterministic,
      costSavingsRatio: ratio,
      candidatesAvoided: baseline.candidateRecordedCount - deterministic.candidateRecordedCount,
    });
    process.stderr.write(
      `[bench5] ${goal.id} (${goal.obligations.length} oblig, expected det=${goal.expectedDeterministic}): baseline candidates=${baseline.candidateRecordedCount} det candidates=${deterministic.candidateRecordedCount} det-satisfied=${deterministic.deterministicObligations} cost-ratio=${ratio.toFixed(3)}× (>1 means det cheaper)\n`,
    );
  }

  // §8 (a): tagged obligations satisfied with zero LLM tokens.
  const allDeterministicSatisfied = rows.every(
    (r) => r.deterministic.deterministicObligations === r.expectedDeterministic,
  );
  // §8 (b): deterministic effective input strictly lower than baseline
  // for goals whose deterministic share is non-zero.
  const allCheaper = rows.every(
    (r) =>
      r.expectedDeterministic === 0 ||
      r.deterministic.effectiveInput < r.baseline.effectiveInput,
  );
  // Quality: every deterministic run must satisfy 100% of obligations.
  const allSatisfied = rows.every((r) => r.deterministic.satisfied === r.obligationCount);

  const report = renderReport({ rows, allDeterministicSatisfied, allCheaper, allSatisfied });
  const reportPath = path.join(flags.outDir, 'v8-phase-5-benchmark.md');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, report, 'utf8');

  fs.mkdirSync(path.dirname(flags.jsonl), { recursive: true });
  const ts = new Date().toISOString();
  for (const r of rows) {
    fs.appendFileSync(
      flags.jsonl,
      JSON.stringify({
        ts,
        suite: 'phase5-deterministic',
        goalId: r.goalId,
        obligationCount: r.obligationCount,
        expectedDeterministic: r.expectedDeterministic,
        baseline: flatten(r.baseline),
        deterministic: flatten(r.deterministic),
        costSavingsRatio: r.costSavingsRatio,
        candidatesAvoided: r.candidatesAvoided,
      }) + '\n',
      'utf8',
    );
  }
  fs.appendFileSync(
    flags.jsonl,
    JSON.stringify({
      ts,
      suite: 'phase5-summary',
      allDeterministicSatisfied,
      allCheaper,
      allSatisfied,
      goalCount: rows.length,
    }) + '\n',
    'utf8',
  );

  process.stderr.write(`\n[bench5] report:  ${reportPath}\n`);
  process.stderr.write(`[bench5] history: ${flags.jsonl}\n`);
  process.stderr.write(
    `[bench5] every tagged obligation satisfied via WASM (§8 (a)): ${allDeterministicSatisfied ? 'PASS' : 'FAIL'}\n`,
  );
  process.stderr.write(
    `[bench5] deterministic effective-input strictly lower (§8 (b)): ${allCheaper ? 'PASS' : 'FAIL'}\n`,
  );
  process.stderr.write(
    `[bench5] every deterministic run satisfied 100% of obligations: ${allSatisfied ? 'PASS' : 'FAIL'}\n`,
  );

  if (
    flags.refuseOnFailure &&
    !(allDeterministicSatisfied && allCheaper && allSatisfied)
  ) {
    process.exit(1);
  }
}

function flatten(r: DeterministicRunResult): Record<string, unknown> {
  return {
    satisfied: r.satisfied,
    failed: r.failed,
    deterministicObligations: r.deterministicObligations,
    deterministicReroutes: r.deterministicReroutes,
    candidateRecordedCount: r.candidateRecordedCount,
    effectiveInput: r.effectiveInput,
    cacheHitRate: r.cacheHitRate,
    wallTimeMs: r.wallTimeMs,
    totalUsage: r.totalUsage,
  };
}

interface ReportArgs {
  rows: ComparisonRow[];
  allDeterministicSatisfied: boolean;
  allCheaper: boolean;
  allSatisfied: boolean;
}

function renderReport(args: ReportArgs): string {
  const lines: string[] = [];
  lines.push('# Phase 5 Deterministic-Floor Benchmark');
  lines.push('');
  lines.push('Generated by `node dist/scripts/v8-bench/run-phase5.js`.');
  lines.push('');
  lines.push('## Methodology');
  lines.push('');
  lines.push(
    'Phase 5 §8 says a goal containing at least one deterministic-eligible obligation completes that obligation with zero LLM tokens, and that goals dominated by deterministic obligations cost dramatically less than the synthesis path. The benchmark compares:',
  );
  lines.push('');
  lines.push(
    '- **baseline**: population manager runs without a `wasmRuntime`. Every `file-must-exist` obligation goes through the architect persona; the synthesis surface is the only path.',
  );
  lines.push(
    '- **deterministic**: population manager runs with `createDefaultRuntime()`. Tagged obligations short-circuit through `WasmRuntime.dispatch`; only un-tagged obligations and the build/test obligations hit the architect persona.',
  );
  lines.push('');
  lines.push(
    'Goals dominated by boilerplate (LICENSE, README.md, .gitignore, .editorconfig, CHANGELOG.md) auto-tag with `scaffold-template` via the contract compiler. The mixed goal includes one source-file obligation that does NOT auto-tag — it always falls through to synthesis.',
  );
  lines.push('');
  lines.push('## Results');
  lines.push('');
  lines.push('| Goal | Oblig. | Expected det. | Baseline candidates | Det. candidates | Avoided | Det. satisfied | Eff. tokens (base) | Eff. tokens (det) | Cost ratio (base/det) |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of args.rows) {
    const ratio = Number.isFinite(r.costSavingsRatio)
      ? `${r.costSavingsRatio.toFixed(3)}×`
      : '∞';
    lines.push(
      `| ${r.goalId} | ${r.obligationCount} | ${r.expectedDeterministic} | ${r.baseline.candidateRecordedCount} | ${r.deterministic.candidateRecordedCount} | ${r.candidatesAvoided} | ${r.deterministic.deterministicObligations} | ${r.baseline.effectiveInput.toFixed(0)} | ${r.deterministic.effectiveInput.toFixed(0)} | ${ratio} |`,
    );
  }
  lines.push('');
  lines.push('## Phase 5 §8 verdict');
  lines.push('');
  lines.push(
    `- **Every tagged obligation satisfied via the WASM runtime (§8 (a)):** ${args.allDeterministicSatisfied ? 'PASS' : 'FAIL'}`,
  );
  lines.push(
    `- **Deterministic effective-input strictly lower than baseline on every dominated goal (§8 (b)):** ${args.allCheaper ? 'PASS' : 'FAIL'}`,
  );
  lines.push(
    `- **Every deterministic run satisfies 100% of obligations:** ${args.allSatisfied ? 'PASS' : 'FAIL'}`,
  );
  lines.push('');
  lines.push('## Reproducibility');
  lines.push('');
  lines.push('    npm run build');
  lines.push('    node dist/scripts/v8-bench/run-phase5.js');
  lines.push('');
  lines.push(
    'Re-running on the same source tree yields identical numbers because StubSession + the WASM strategies are both deterministic.',
  );
  lines.push('');
  lines.push('## Caveats');
  lines.push('');
  lines.push(
    '- The deterministic floor handles the obligation tag itself; the test/build obligations still call into the synthesis path because the v1 obligation set has no deterministic strategies for shell-command satisfaction. A future Phase 7 expansion can ship `command-satisfaction` strategies (e.g., a "package.json scripts.test must contain X" strategy).',
  );
  lines.push(
    '- Goals with a non-zero source-file fraction (the `mixed-boilerplate-and-source` row) save tokens proportional to the boilerplate fraction, not the entire goal. The benchmark does NOT enforce a savings ratio on those goals; the §8 (b) gate is conditional on `expectedDeterministic > 0`.',
  );
  lines.push(
    '- Effective-input tokens use the published Anthropic cache multipliers (cache-read 0.1×, cache-write 1.25×). Tagged obligations consume zero of any kind, so the savings here are direct: every avoided candidate-recorded entry is the synthesis-call cost the deterministic floor sidesteps.',
  );
  lines.push('');
  return lines.join('\n');
}

main().catch((err) => {
  process.stderr.write(`[bench5] fatal: ${(err as Error).stack ?? (err as Error).message}\n`);
  process.exit(2);
});
