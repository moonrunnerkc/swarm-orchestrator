import type { GoalRunResult } from './run-goal';

/**
 * Per-goal pairing of single-mode and tournament-mode runs against the same
 * v6 baseline. Used by the Phase 3 §6 ship-gate to assert tournament cost
 * stays within 1.5× of single-mode cost.
 */
export interface ModeComparisonRow {
  goalId: string;
  size: GoalRunResult['size'];
  obligationCount: number;
  single: GoalRunResult;
  tournament: GoalRunResult;
  /** tournament effective input / single effective input. */
  costMultiplier: number;
}

export interface BenchSummary {
  goalCount: number;
  totalObligations: number;
  totalSatisfied: number;
  totalFailed: number;
  v8PassRate: number;
  /** v6 pass rate is assumed 1.0 in the synthetic model; explicit for clarity. */
  v6PassRate: number;
  v8TotalEffectiveInput: number;
  v6TotalEffectiveInput: number;
  v8TotalOutput: number;
  v6TotalOutput: number;
  /** v8 / v6 effective-input ratio; <1 means v8 is cheaper. */
  totalInputRatio: number;
  /** 1 - totalInputRatio. */
  totalInputReductionPct: number;
  /** Pass-rate delta in absolute percentage points (v8 - v6). */
  passRateDelta: number;
  /** Mean v8 cache hit rate across goals. */
  meanCacheHitRate: number;
  /** True when both Phase 2 §5 exit conditions hold. */
  meets30PctFloor: boolean;
  passRateWithin5Pct: boolean;
}

/**
 * Aggregate per-goal bench results into a Phase 2 §5 exit-criteria check.
 *
 * Exit criteria:
 *   1. v8 effective input ≥ 30% lower than v6 (totalInputReductionPct ≥ 0.3).
 *   2. Pass rate within 5% of v6 (|passRateDelta| ≤ 0.05).
 *   3. Cache hit rate measurable (>0) — implicit in usage data.
 */
export function summarize(results: readonly GoalRunResult[]): BenchSummary {
  let totalObligations = 0;
  let totalSatisfied = 0;
  let totalFailed = 0;
  let v8In = 0;
  let v6In = 0;
  let v8Out = 0;
  let v6Out = 0;
  let cacheRateSum = 0;
  for (const r of results) {
    totalObligations += r.obligationCount;
    totalSatisfied += r.satisfied;
    totalFailed += r.failed;
    v8In += r.v8EffectiveInput;
    v6In += r.v6EffectiveInput;
    v8Out += r.v8Usage.outputTokens;
    v6Out += r.v6Usage.outputTokens;
    cacheRateSum += r.v8CacheHitRate;
  }
  const v8PassRate = totalObligations === 0 ? 0 : totalSatisfied / totalObligations;
  const v6PassRate = 1.0;
  const inputRatio = v6In === 0 ? 0 : v8In / v6In;
  const reduction = 1 - inputRatio;
  const passDelta = v8PassRate - v6PassRate;
  return {
    goalCount: results.length,
    totalObligations,
    totalSatisfied,
    totalFailed,
    v8PassRate,
    v6PassRate,
    v8TotalEffectiveInput: v8In,
    v6TotalEffectiveInput: v6In,
    v8TotalOutput: v8Out,
    v6TotalOutput: v6Out,
    totalInputRatio: inputRatio,
    totalInputReductionPct: reduction,
    passRateDelta: passDelta,
    meanCacheHitRate: results.length === 0 ? 0 : cacheRateSum / results.length,
    meets30PctFloor: reduction >= 0.3,
    passRateWithin5Pct: Math.abs(passDelta) <= 0.05,
  };
}

/**
 * Render the per-goal table and a tail summary as Markdown. Format chosen to
 * be inline in `docs/v8-phase-2-benchmark.md` and replayable by a casual
 * reader.
 */
export function renderMarkdown(results: readonly GoalRunResult[], summary: BenchSummary): string {
  const lines: string[] = [];
  lines.push('| goal | size | oblig | v8 satisfied | v6 eff-in | v8 eff-in | reduction | cache hit | v8 wall ms |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    lines.push(
      `| ${r.goalId} | ${r.size} | ${r.obligationCount} | ${r.satisfied}/${r.obligationCount} | ${r.v6EffectiveInput.toFixed(0)} | ${r.v8EffectiveInput.toFixed(0)} | ${(r.inputReductionPct * 100).toFixed(1)}% | ${(r.v8CacheHitRate * 100).toFixed(1)}% | ${r.v8WallTimeMs} |`,
    );
  }
  lines.push('');
  lines.push(`**Goals:** ${summary.goalCount}`);
  lines.push(`**Total obligations:** ${summary.totalObligations}`);
  lines.push(
    `**v8 pass rate:** ${(summary.v8PassRate * 100).toFixed(1)}% (satisfied=${summary.totalSatisfied}, failed=${summary.totalFailed})`,
  );
  lines.push(`**v6 modeled pass rate:** ${(summary.v6PassRate * 100).toFixed(1)}%`);
  lines.push(`**Pass-rate delta (v8 − v6):** ${(summary.passRateDelta * 100).toFixed(2)} pp`);
  lines.push(
    `**v6 total effective input:** ${summary.v6TotalEffectiveInput.toFixed(0)} tokens`,
  );
  lines.push(
    `**v8 total effective input:** ${summary.v8TotalEffectiveInput.toFixed(0)} tokens`,
  );
  lines.push(
    `**Effective-input reduction:** ${(summary.totalInputReductionPct * 100).toFixed(2)}%`,
  );
  lines.push(`**Mean v8 cache hit rate:** ${(summary.meanCacheHitRate * 100).toFixed(2)}%`);
  lines.push('');
  lines.push(`**Phase 2 §5 floor (≥30% reduction):** ${summary.meets30PctFloor ? 'PASS' : 'FAIL'}`);
  lines.push(`**Phase 2 §5 floor (pass rate within 5%):** ${summary.passRateWithin5Pct ? 'PASS' : 'FAIL'}`);
  return lines.join('\n');
}

/**
 * Phase 3 §6 mode comparison summary. Tournament mode must be no more
 * than 1.5× single-persona cost while showing measurably better pass
 * rate on tricky obligations. The "tricky" subset is identified by the
 * caller (typically the explicitly-marked `tricky*` goals).
 */
export interface ModeComparisonSummary {
  rowCount: number;
  totalSingleEffectiveInput: number;
  totalTournamentEffectiveInput: number;
  /** Aggregate tournament/single cost ratio. */
  costMultiplier: number;
  singlePassRate: number;
  tournamentPassRate: number;
  /** Pass-rate delta in absolute percentage points (tournament − single). */
  passRateDelta: number;
  /** True when the aggregate cost multiplier is ≤ 1.5. */
  meets1_5xCap: boolean;
  /** True when tournament pass rate is ≥ single pass rate. */
  noPassRateRegression: boolean;
}

/** Build a comparison summary from per-goal mode pairs. */
export function summarizeModeComparison(
  rows: readonly ModeComparisonRow[],
): ModeComparisonSummary {
  let single = 0;
  let tournament = 0;
  let totalOblig = 0;
  let singleSat = 0;
  let tournamentSat = 0;
  for (const r of rows) {
    single += r.single.v8EffectiveInput;
    tournament += r.tournament.v8EffectiveInput;
    totalOblig += r.obligationCount;
    singleSat += r.single.satisfied;
    tournamentSat += r.tournament.satisfied;
  }
  const multiplier = single === 0 ? 0 : tournament / single;
  const singlePass = totalOblig === 0 ? 0 : singleSat / totalOblig;
  const tournamentPass = totalOblig === 0 ? 0 : tournamentSat / totalOblig;
  return {
    rowCount: rows.length,
    totalSingleEffectiveInput: single,
    totalTournamentEffectiveInput: tournament,
    costMultiplier: multiplier,
    singlePassRate: singlePass,
    tournamentPassRate: tournamentPass,
    passRateDelta: tournamentPass - singlePass,
    meets1_5xCap: multiplier <= 1.5,
    noPassRateRegression: tournamentPass >= singlePass,
  };
}

/**
 * Render a Markdown table comparing single vs tournament modes for the
 * Phase 3 §6 cost-and-accuracy ship-gate.
 */
export function renderModeComparison(
  rows: readonly ModeComparisonRow[],
  summary: ModeComparisonSummary,
): string {
  const lines: string[] = [];
  lines.push(
    '| goal | size | oblig | single eff-in | tournament eff-in | tour/single | single pass | tournament pass |',
  );
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    lines.push(
      `| ${r.goalId} | ${r.size} | ${r.obligationCount} | ${r.single.v8EffectiveInput.toFixed(0)} | ${r.tournament.v8EffectiveInput.toFixed(0)} | ${r.costMultiplier.toFixed(2)}× | ${r.single.satisfied}/${r.obligationCount} | ${r.tournament.satisfied}/${r.obligationCount} |`,
    );
  }
  lines.push('');
  lines.push(`**Goals compared:** ${summary.rowCount}`);
  lines.push(
    `**Total single eff-in:** ${summary.totalSingleEffectiveInput.toFixed(0)} tokens`,
  );
  lines.push(
    `**Total tournament eff-in:** ${summary.totalTournamentEffectiveInput.toFixed(0)} tokens`,
  );
  lines.push(`**Tournament/single cost multiplier:** ${summary.costMultiplier.toFixed(3)}×`);
  lines.push(
    `**Single pass rate:** ${(summary.singlePassRate * 100).toFixed(1)}%`,
  );
  lines.push(
    `**Tournament pass rate:** ${(summary.tournamentPassRate * 100).toFixed(1)}%`,
  );
  lines.push(
    `**Pass-rate delta (tournament − single):** ${(summary.passRateDelta * 100).toFixed(2)} pp`,
  );
  lines.push('');
  lines.push(
    `**Phase 3 §6 cap (≤1.5× single):** ${summary.meets1_5xCap ? 'PASS' : 'FAIL'}`,
  );
  lines.push(
    `**Phase 3 §6 (no pass-rate regression):** ${summary.noPassRateRegression ? 'PASS' : 'FAIL'}`,
  );
  return lines.join('\n');
}
