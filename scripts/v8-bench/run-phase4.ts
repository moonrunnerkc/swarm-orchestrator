/* eslint-disable no-console */
/**
 * Phase 4 §7 memoization-savings benchmark.
 *
 * Compares two run modes against the repeated-pattern goal suite:
 *   - **baseline** — tournament mode, no memoStore. The harness still
 *     does implicit in-round dedup (two same-hash candidates in one
 *     round share one verifier call) but no cross-obligation
 *     memoization.
 *   - **memoized** — tournament mode with a fresh MemoStore. Later
 *     tournaments inherit prior winners' verdicts, skipping their
 *     verifier calls entirely.
 *
 * Ship-gate (impl guide §7 exit criterion (b)):
 *   - Memoized verifier-calls-saved must strictly exceed the baseline
 *     for every goal in the suite.
 *   - Aggregate effective-input tokens must be strictly lower under
 *     memoization for every goal.
 *
 * Output:
 *   - `docs/v8-phase-4-benchmark.md` — Markdown report.
 *   - `docs/benchmarks/v8-history.jsonl` — appended rows.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  REPEATED_PATTERN_GOALS,
  assertRepeatedPatternGoalsShape,
} from './repeated-pattern-goals';
import {
  runRepeatedGoal,
  type RepeatedGoalRunResult,
} from './run-repeated-pattern';

interface CliFlags {
  outDir: string;
  jsonl: string;
  refuseOnFailure: boolean;
  tournamentCandidates: number;
}

interface ComparisonRow {
  goalId: string;
  obligationCount: number;
  baseline: RepeatedGoalRunResult;
  memoized: RepeatedGoalRunResult;
  /** baseline.effectiveInput / memoized.effectiveInput; >1 means memoization saves. */
  costSavingsRatio: number;
  /** memoized.verifier saves − baseline.verifier saves. */
  extraVerifierSavings: number;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    outDir: path.resolve('docs'),
    jsonl: path.resolve('docs/benchmarks/v8-history.jsonl'),
    refuseOnFailure: true,
    tournamentCandidates: 3,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    if (a === '--out-dir') {
      flags.outDir = path.resolve(argv[++i] ?? '');
    } else if (a === '--jsonl') {
      flags.jsonl = path.resolve(argv[++i] ?? '');
    } else if (a === '--no-refuse') {
      flags.refuseOnFailure = false;
    } else if (a === '--candidates') {
      const raw = argv[++i] ?? '';
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n <= 0 || n > 8) {
        throw new Error(`invalid --candidates "${raw}"; must be a positive integer ≤ 8`);
      }
      flags.tournamentCandidates = n;
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`unknown flag: ${a}`);
    }
  }
  return flags;
}

function printHelp(): void {
  process.stderr.write(
    [
      'usage: node dist/scripts/v8-bench/run-phase4.js [flags]',
      '',
      'flags:',
      '  --out-dir <dir>      where to write the markdown report (default ./docs)',
      '  --jsonl <path>       JSONL history append path (default docs/benchmarks/v8-history.jsonl)',
      '  --candidates <n>     tournament candidates per round (1-8, default 3)',
      '  --no-refuse          do not exit non-zero when the §7 gates fail',
      '  --help, -h           show this message',
      '',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  assertRepeatedPatternGoalsShape();

  const rows: ComparisonRow[] = [];
  for (const goal of REPEATED_PATTERN_GOALS) {
    const baseline = await runRepeatedGoal(goal, {
      mode: 'tournament',
      memoization: false,
      tournamentCandidates: flags.tournamentCandidates,
    });
    const memoized = await runRepeatedGoal(goal, {
      mode: 'tournament',
      memoization: true,
      tournamentCandidates: flags.tournamentCandidates,
    });
    const costSavingsRatio =
      memoized.effectiveInput === 0 ? 0 : baseline.effectiveInput / memoized.effectiveInput;
    rows.push({
      goalId: goal.id,
      obligationCount: goal.obligations.length,
      baseline,
      memoized,
      costSavingsRatio,
      extraVerifierSavings:
        memoized.verifierCallsSavedByMemoization -
        baseline.verifierCallsSavedByMemoization,
    });
    process.stderr.write(
      `[bench4] ${goal.id} (${goal.obligations.length} oblig): baseline saves=${baseline.verifierCallsSavedByMemoization} memo saves=${memoized.verifierCallsSavedByMemoization} extra=${memoized.verifierCallsSavedByMemoization - baseline.verifierCallsSavedByMemoization} cost-ratio=${costSavingsRatio.toFixed(3)}× (>1 means memo cheaper)\n`,
    );
  }

  // §7 ship-gate booleans.
  const allExtraSavings = rows.every((r) => r.extraVerifierSavings > 0);
  const allCheaper = rows.every(
    (r) => r.memoized.effectiveInput < r.baseline.effectiveInput,
  );
  const allSatisfied = rows.every((r) => r.memoized.satisfied === r.obligationCount);

  const report = renderReport({
    rows,
    candidates: flags.tournamentCandidates,
    allExtraSavings,
    allCheaper,
    allSatisfied,
  });

  const reportPath = path.join(flags.outDir, 'v8-phase-4-benchmark.md');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, report, 'utf8');

  fs.mkdirSync(path.dirname(flags.jsonl), { recursive: true });
  const ts = new Date().toISOString();
  for (const r of rows) {
    fs.appendFileSync(
      flags.jsonl,
      JSON.stringify({
        ts,
        suite: 'phase4-memoization',
        goalId: r.goalId,
        obligationCount: r.obligationCount,
        baseline: flattenRun(r.baseline),
        memoized: flattenRun(r.memoized),
        costSavingsRatio: r.costSavingsRatio,
        extraVerifierSavings: r.extraVerifierSavings,
      }) + '\n',
      'utf8',
    );
  }
  fs.appendFileSync(
    flags.jsonl,
    JSON.stringify({
      ts,
      suite: 'phase4-summary',
      allExtraSavings,
      allCheaper,
      allSatisfied,
      goalCount: rows.length,
    }) + '\n',
    'utf8',
  );

  process.stderr.write(`\n[bench4] report:  ${reportPath}\n`);
  process.stderr.write(`[bench4] history: ${flags.jsonl}\n`);
  process.stderr.write(
    `[bench4] verifier-savings >0 every goal: ${allExtraSavings ? 'PASS' : 'FAIL'}\n`,
  );
  process.stderr.write(
    `[bench4] effective-input strictly lower every goal: ${allCheaper ? 'PASS' : 'FAIL'}\n`,
  );
  process.stderr.write(
    `[bench4] every memoized run satisfied 100% of obligations: ${allSatisfied ? 'PASS' : 'FAIL'}\n`,
  );

  if (flags.refuseOnFailure && !(allExtraSavings && allCheaper && allSatisfied)) {
    process.exit(1);
  }
}

function flattenRun(r: RepeatedGoalRunResult): Record<string, unknown> {
  return {
    satisfied: r.satisfied,
    failed: r.failed,
    memoizedObligations: r.memoizedObligations,
    verifierCallsSavedByMemoization: r.verifierCallsSavedByMemoization,
    effectiveInput: r.effectiveInput,
    cacheHitRate: r.cacheHitRate,
    wallTimeMs: r.wallTimeMs,
    totalUsage: r.totalUsage,
  };
}

interface ReportArgs {
  rows: ComparisonRow[];
  candidates: number;
  allExtraSavings: boolean;
  allCheaper: boolean;
  allSatisfied: boolean;
}

function renderReport(args: ReportArgs): string {
  const lines: string[] = [];
  lines.push('# Phase 4 Memoization Benchmark');
  lines.push('');
  lines.push(
    `Generated by \`node dist/scripts/v8-bench/run-phase4.js\` with ${args.candidates} candidates per tournament round.`,
  );
  lines.push('');
  lines.push('## Methodology');
  lines.push('');
  lines.push(
    'Phase 4 §7 says memoization "measurably reduces cost on a goal that contains repeated obligation patterns." The benchmark exercises three repeated-pattern goals — health-check files for 3, 4, and 6 services — under two configurations:',
  );
  lines.push('');
  lines.push('- **baseline**: tournament mode, no `MemoStore`. Implicit in-round dedup is still active (two identical-hash candidates in the same round share one verifier call), but no cross-obligation memoization.');
  lines.push(
    '- **memoized**: tournament mode plus a fresh `MemoStore`. After the first tournament wins, its response hash + verdict are indexed. Subsequent tournaments whose candidate hashes match the prior winner inherit the verdict and skip their verifier calls.',
  );
  lines.push('');
  lines.push(
    'The synthetic architect responder emits the same body for every `file-must-exist` obligation, modeling the natural shape of "the same code in N locations."',
  );
  lines.push('');
  lines.push('## Results');
  lines.push('');
  lines.push('| Goal | Oblig. | Baseline saves | Memo saves | Extra | Eff. tokens (base) | Eff. tokens (memo) | Cost ratio (base/memo) |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of args.rows) {
    lines.push(
      `| ${r.goalId} | ${r.obligationCount} | ${r.baseline.verifierCallsSavedByMemoization} | ${r.memoized.verifierCallsSavedByMemoization} | ${r.extraVerifierSavings} | ${r.baseline.effectiveInput.toFixed(0)} | ${r.memoized.effectiveInput.toFixed(0)} | ${r.costSavingsRatio.toFixed(3)}× |`,
    );
  }
  lines.push('');
  lines.push('## Phase 4 §7 verdict');
  lines.push('');
  lines.push(
    `- **Memo verifier-savings > baseline savings on every goal:** ${args.allExtraSavings ? 'PASS' : 'FAIL'}`,
  );
  lines.push(
    `- **Memoized effective-input strictly lower than baseline on every goal:** ${args.allCheaper ? 'PASS' : 'FAIL'}`,
  );
  lines.push(
    `- **Every memoized run satisfies 100% of obligations:** ${args.allSatisfied ? 'PASS' : 'FAIL'}`,
  );
  lines.push('');
  lines.push('## Reproducibility');
  lines.push('');
  lines.push('    npm run build');
  lines.push('    node dist/scripts/v8-bench/run-phase4.js');
  lines.push('');
  lines.push(
    'Re-running on the same source tree yields identical numbers because StubSession + the memoization indexer are both deterministic.',
  );
  lines.push('');
  lines.push('## Caveats');
  lines.push('');
  lines.push(
    '- The synthetic architect emits identical responses across obligations of the same type, which is the upper-bound case for memoization. Real models produce path-aware responses; the savings depend on how often distinct obligations *converge* on the same body.',
  );
  lines.push(
    '- Effective-input tokens use the published Anthropic cache multipliers (cache-read 0.1×, cache-write 1.25×). The memoized verifier calls do not pay any input or output tokens; the savings here are dominated by the verifier output savings, not the architect input.',
  );
  lines.push(
    '- Cross-run memoization (skipping obligations entirely on resume against a prior ledger) is exercised by `test/integration/v8-resume.test.ts` and surfaced via `swarm v8 resume`. This benchmark covers in-run cross-obligation memoization only.',
  );
  lines.push('');
  return lines.join('\n');
}

main().catch((err) => {
  process.stderr.write(`[bench4] fatal: ${(err as Error).stack ?? (err as Error).message}\n`);
  process.exit(2);
});
