import { strict as assert } from 'assert';
import { BENCH_GOALS, assertSuiteShape } from '../../scripts/v8-bench/goals';
import { runBenchGoal } from '../../scripts/v8-bench/run-goal';
import { summarize } from '../../scripts/v8-bench/aggregate';
import { modelV6Usage, DEFAULT_V6_MODEL } from '../../scripts/v8-bench/v6-model';
import { effectiveInputTokens } from '../../src/session/types';

describe('v8 bench: suite shape', () => {
  it('has 5 small + 3 medium + 2 large goals (impl guide §5)', () => {
    assertSuiteShape();
    assert.equal(BENCH_GOALS.length, 10);
  });

  it('every goal has at least one build- and test-must-pass obligation', () => {
    for (const g of BENCH_GOALS) {
      const types = g.obligations.map((o) => o.type);
      assert.ok(types.includes('build-must-pass'), `${g.id} has build-must-pass`);
      assert.ok(types.includes('test-must-pass'), `${g.id} has test-must-pass`);
    }
  });

  it('size class matches obligation count', () => {
    for (const g of BENCH_GOALS) {
      const n = g.obligations.length;
      if (g.size === 'small') assert.ok(n <= 3, `${g.id} small ⇒ n≤3`);
      else if (g.size === 'medium') assert.ok(n >= 4 && n <= 8, `${g.id} medium ⇒ 4≤n≤8`);
      else assert.ok(n > 8, `${g.id} large ⇒ n>8`);
    }
  });
});

describe('v8 bench: v6 cost model', () => {
  it('modelV6Usage scales linearly with obligation count', () => {
    const oblg3 = BENCH_GOALS[0]?.obligations ?? [];
    const oblg11 = BENCH_GOALS[BENCH_GOALS.length - 1]?.obligations ?? [];
    const u3 = modelV6Usage(oblg3);
    const u11 = modelV6Usage(oblg11);
    assert.ok(u11.inputTokens > u3.inputTokens);
    assert.ok(u11.outputTokens > u3.outputTokens);
    // Per-obligation cost should be approximately constant.
    const per3 = u3.inputTokens / oblg3.length;
    const per11 = u11.inputTokens / oblg11.length;
    assert.ok(Math.abs(per3 - per11) < 1, `per-obligation v6 cost is constant`);
  });

  it('modelV6Usage applies DEFAULT_V6_MODEL retry tax', () => {
    const u = modelV6Usage([
      { type: 'build-must-pass', command: 'b' },
      { type: 'test-must-pass', command: 't' },
    ]);
    // Two obligations; retry factor 0.9 ⇒ 2 + 0.9*2 = 3.8 effective attempts.
    const expectedInput =
      3.8 * (DEFAULT_V6_MODEL.bootstrapTokens + DEFAULT_V6_MODEL.dynamicTokens);
    assert.equal(u.inputTokens, expectedInput);
    assert.equal(u.cacheReadTokens, 0);
    assert.equal(u.cacheCreationTokens, 0);
  });
});

describe('v8 bench: end-to-end on a single goal', () => {
  it('produces a satisfied=N result and meets the 30% floor on a small goal', async () => {
    const goal = BENCH_GOALS[0];
    assert.ok(goal);
    const r = await runBenchGoal(goal);
    assert.equal(r.satisfied, r.obligationCount);
    assert.equal(r.failed, 0);
    assert.ok(r.inputReductionPct >= 0.3, `${r.goalId}: ${r.inputReductionPct}`);
    assert.ok(r.v8CacheHitRate > 0, 'cache hit rate must be measurable on multi-call runs');
  });

  it('large goals achieve a steeper reduction than small goals (cache amortization)', async () => {
    const small = BENCH_GOALS.find((g) => g.size === 'small');
    const large = BENCH_GOALS.find((g) => g.size === 'large');
    assert.ok(small && large);
    const rSmall = await runBenchGoal(small);
    const rLarge = await runBenchGoal(large);
    // Cache amortization: larger contracts share the cached prefix across
    // more obligations, so the reduction percentage rises.
    assert.ok(
      rLarge.inputReductionPct > rSmall.inputReductionPct,
      `large reduction (${rLarge.inputReductionPct}) should exceed small (${rSmall.inputReductionPct})`,
    );
  });
});

describe('v8 bench: aggregator', () => {
  it('summarize(empty) returns zeros without crashing', () => {
    const s = summarize([]);
    assert.equal(s.goalCount, 0);
    assert.equal(s.v8PassRate, 0);
    assert.equal(s.totalInputRatio, 0);
  });

  it('summarize records the §5 ship-gate booleans', async () => {
    const r = await runBenchGoal(BENCH_GOALS[0]!);
    const s = summarize([r]);
    assert.equal(s.goalCount, 1);
    assert.equal(s.totalSatisfied, r.satisfied);
    assert.equal(s.passRateWithin5Pct, true);
    assert.equal(s.meets30PctFloor, true);
  });
});

describe('v8 bench: full suite ship-gate', () => {
  it('aggregate of all 10 goals satisfies §5 (≥30% reduction, pass rate within 5%)', async () => {
    const results = [];
    for (const g of BENCH_GOALS) {
      results.push(await runBenchGoal(g));
    }
    const s = summarize(results);
    assert.equal(s.goalCount, 10);
    assert.ok(
      s.meets30PctFloor,
      `aggregate reduction ${(s.totalInputReductionPct * 100).toFixed(2)}% must be ≥30%`,
    );
    assert.ok(
      s.passRateWithin5Pct,
      `pass-rate delta ${(s.passRateDelta * 100).toFixed(2)} pp must be within 5%`,
    );
    // Mean cache hit rate must be measurable.
    assert.ok(s.meanCacheHitRate > 0);
  }).timeout(20_000);
});

describe('v8 bench: effective-input math is consistent', () => {
  it('summary v6 effective input equals sum of per-goal v6 effective inputs', async () => {
    const results = [];
    for (const g of BENCH_GOALS) {
      results.push(await runBenchGoal(g));
    }
    const s = summarize(results);
    const sumV6 = results.reduce((t, r) => t + r.v6EffectiveInput, 0);
    const sumV8 = results.reduce((t, r) => t + r.v8EffectiveInput, 0);
    assert.equal(s.v6TotalEffectiveInput, sumV6);
    assert.equal(s.v8TotalEffectiveInput, sumV8);
    // Sanity: effectiveInputTokens of an empty usage is 0.
    assert.equal(
      effectiveInputTokens({ inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0 }),
      0,
    );
  }).timeout(20_000);
});
