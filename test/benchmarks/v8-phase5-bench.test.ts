import { strict as assert } from 'assert';
import {
  DETERMINISTIC_GOALS,
  assertDeterministicGoalsShape,
} from '../../scripts/v8-bench/deterministic-goals';
import { runDeterministicGoal } from '../../scripts/v8-bench/run-deterministic';

describe('v8 phase-5 bench: deterministic-goal shape', () => {
  it('declares ≥3 goals with consistent expectedDeterministic counts', () => {
    assertDeterministicGoalsShape();
    assert.ok(DETERMINISTIC_GOALS.length >= 3);
  });
});

describe('v8 phase-5 bench: §8 (a) — tagged obligations satisfied with zero LLM tokens', () => {
  it('every goal: tagged-count == deterministic-satisfied count and ledger has no candidates for those obligations', async function () {
    this.timeout(20000);
    for (const goal of DETERMINISTIC_GOALS) {
      const det = await runDeterministicGoal(goal, {
        mode: 'single',
        deterministic: true,
      });
      assert.equal(
        det.deterministicObligations,
        goal.expectedDeterministic,
        `${goal.id}: deterministic-satisfied=${det.deterministicObligations} but expected=${goal.expectedDeterministic}`,
      );
      assert.equal(det.failed, 0, `${goal.id} failed obligations`);
    }
  });
});

describe('v8 phase-5 bench: §8 (b) — deterministic configuration costs less', () => {
  it('deterministic effective input is strictly lower than baseline on every dominated goal', async function () {
    this.timeout(20000);
    for (const goal of DETERMINISTIC_GOALS) {
      if (goal.expectedDeterministic === 0) continue;
      const baseline = await runDeterministicGoal(goal, {
        mode: 'single',
        deterministic: false,
      });
      const det = await runDeterministicGoal(goal, {
        mode: 'single',
        deterministic: true,
      });
      assert.ok(
        det.effectiveInput < baseline.effectiveInput,
        `${goal.id}: det effective-input (${det.effectiveInput.toFixed(0)}) must be strictly lower than baseline (${baseline.effectiveInput.toFixed(0)})`,
      );
      assert.ok(
        det.candidateRecordedCount < baseline.candidateRecordedCount,
        `${goal.id}: det candidate count (${det.candidateRecordedCount}) must be strictly lower than baseline (${baseline.candidateRecordedCount})`,
      );
    }
  });
});

describe('v8 phase-5 bench: savings scale with the deterministic share', () => {
  it('a 5-boilerplate goal saves more candidates than a 3-boilerplate goal', async function () {
    this.timeout(20000);
    const small = DETERMINISTIC_GOALS.find((g) => g.id === 'boilerplate-3');
    const large = DETERMINISTIC_GOALS.find((g) => g.id === 'boilerplate-5');
    assert.ok(small && large);
    if (!small || !large) return;
    const smallBase = await runDeterministicGoal(small, { mode: 'single', deterministic: false });
    const smallDet = await runDeterministicGoal(small, { mode: 'single', deterministic: true });
    const largeBase = await runDeterministicGoal(large, { mode: 'single', deterministic: false });
    const largeDet = await runDeterministicGoal(large, { mode: 'single', deterministic: true });
    const smallAvoided = smallBase.candidateRecordedCount - smallDet.candidateRecordedCount;
    const largeAvoided = largeBase.candidateRecordedCount - largeDet.candidateRecordedCount;
    assert.ok(
      largeAvoided > smallAvoided,
      `expected larger goal to avoid more candidates: small=${smallAvoided}, large=${largeAvoided}`,
    );
  });
});
