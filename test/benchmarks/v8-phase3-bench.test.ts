import { strict as assert } from 'assert';
import { BENCH_GOALS } from '../../scripts/v8-bench/goals';
import { runBenchGoal } from '../../scripts/v8-bench/run-goal';
import {
  TRICKY_BENCH_GOALS,
  assertTrickyGoalsShape,
} from '../../scripts/v8-bench/tricky-goals';
import { runTrickyGoal } from '../../scripts/v8-bench/run-tricky-goal';
import {
  summarizeModeComparison,
  type ModeComparisonRow,
} from '../../scripts/v8-bench/aggregate';

describe('v8 phase-3 bench: tricky-suite shape', () => {
  it('tricky suite passes its shape assertion', () => {
    assertTrickyGoalsShape();
    assert.equal(TRICKY_BENCH_GOALS.length >= 3, true);
  });
});

describe('v8 phase-3 bench: tournament accuracy lift on tricky obligations', () => {
  it('tournament mode satisfies at least as many obligations as single mode on every tricky goal', async function () {
    this.timeout(30_000);
    const rows: ModeComparisonRow[] = [];
    for (const goal of TRICKY_BENCH_GOALS) {
      const single = await runTrickyGoal(goal, { mode: 'single' });
      const tournament = await runTrickyGoal(goal, {
        mode: 'tournament',
        tournamentCandidates: 3,
      });
      const costMultiplier = single.v8EffectiveInput === 0
        ? 0
        : tournament.v8EffectiveInput / single.v8EffectiveInput;
      rows.push({
        goalId: goal.id,
        size: goal.size,
        obligationCount: goal.obligations.length,
        single,
        tournament,
        costMultiplier,
      });
    }
    const summary = summarizeModeComparison(rows);
    // §6 (a) hard gate: tournament must not regress and must improve at
    // least one tricky goal strictly.
    assert.equal(summary.noPassRateRegression, true,
      `tournament pass rate ${summary.tournamentPassRate} < single ${summary.singlePassRate}`);
    const strictImprovements = rows.filter(
      (r) => r.tournament.satisfied > r.single.satisfied,
    );
    assert.ok(strictImprovements.length >= 1,
      'expected at least one tricky goal where tournament strictly improves on single');
  });
});

describe('v8 phase-3 bench: tournament cost reporting on easy suite', () => {
  it('reports a measurable single-vs-tournament cost ratio across the easy suite', async function () {
    this.timeout(60_000);
    const rows: ModeComparisonRow[] = [];
    for (const goal of BENCH_GOALS) {
      const single = await runBenchGoal(goal, { mode: 'single' });
      const tournament = await runBenchGoal(goal, {
        mode: 'tournament',
        tournamentCandidates: 3,
      });
      const costMultiplier = single.v8EffectiveInput === 0
        ? 0
        : tournament.v8EffectiveInput / single.v8EffectiveInput;
      rows.push({
        goalId: goal.id,
        size: goal.size,
        obligationCount: goal.obligations.length,
        single,
        tournament,
        costMultiplier,
      });
    }
    const summary = summarizeModeComparison(rows);
    // No accuracy regression on the easy suite (both modes should pass).
    assert.equal(summary.singlePassRate, 1.0);
    assert.equal(summary.tournamentPassRate, 1.0);
    // Cost ratio is informational; expect tournament > single but bounded.
    assert.ok(summary.costMultiplier > 1.0, 'tournament adds cost vs single');
    assert.ok(summary.costMultiplier < 5.0, 'tournament cost ratio is bounded < 5×');
  });
});
