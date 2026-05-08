import { strict as assert } from 'assert';
import { STREAMING_GOALS, assertStreamingGoalsShape } from '../../scripts/v8-bench/streaming-goals';
import { runStreamingGoal } from '../../scripts/v8-bench/run-streaming';

describe('v8 Phase 6 streaming-verification benchmark gate', function () {
  this.timeout(30_000);

  it('declares >=4 goals with at least 3 doomed variants (shape gate)', () => {
    assertStreamingGoalsShape();
    assert.ok(STREAMING_GOALS.length >= 4);
    const doomed = STREAMING_GOALS.filter((g) => g.doomed).length;
    assert.ok(doomed >= 3, `expected >=3 doomed goals, got ${doomed}`);
  });

  it('every doomed goal aborts mid-generation under streaming (§9 (a))', async () => {
    for (const g of STREAMING_GOALS.filter((g) => g.doomed)) {
      const r = await runStreamingGoal(g, { streaming: true });
      assert.ok(
        r.streamingAbortedCandidates > 0,
        `${g.id}: expected streaming abort, got streamingAbortedCandidates=${r.streamingAbortedCandidates}`,
      );
      assert.ok(
        r.candidateStreamAbortedCount > 0,
        `${g.id}: expected at least one candidate-stream-aborted ledger entry`,
      );
    }
  });

  it('streaming output tokens strictly lower than non-streaming baseline on doomed goals (§9 (b))', async () => {
    for (const g of STREAMING_GOALS.filter((g) => g.doomed)) {
      const baseline = await runStreamingGoal(g, { streaming: false });
      const streaming = await runStreamingGoal(g, { streaming: true });
      assert.ok(
        streaming.totalUsage.outputTokens < baseline.totalUsage.outputTokens,
        `${g.id}: expected streaming output (${streaming.totalUsage.outputTokens}) < baseline (${baseline.totalUsage.outputTokens})`,
      );
    }
  });

  it('clean goals never produce a false abort', async () => {
    for (const g of STREAMING_GOALS.filter((g) => !g.doomed)) {
      const r = await runStreamingGoal(g, { streaming: true });
      assert.equal(
        r.streamingAbortedCandidates,
        0,
        `${g.id}: streaming flagged a clean goal as doomed`,
      );
    }
  });

  it('savings scale with response length on doomed goals', async () => {
    const small = STREAMING_GOALS.find((g) => g.id === 'doomed-small');
    const large = STREAMING_GOALS.find((g) => g.id === 'doomed-large');
    assert.ok(small && large);
    if (!small || !large) return;
    const smallBase = await runStreamingGoal(small, { streaming: false });
    const smallStream = await runStreamingGoal(small, { streaming: true });
    const largeBase = await runStreamingGoal(large, { streaming: false });
    const largeStream = await runStreamingGoal(large, { streaming: true });
    const smallSaved = smallBase.totalUsage.outputTokens - smallStream.totalUsage.outputTokens;
    const largeSaved = largeBase.totalUsage.outputTokens - largeStream.totalUsage.outputTokens;
    assert.ok(
      largeSaved > smallSaved,
      `expected larger response to save more tokens: large=${largeSaved} small=${smallSaved}`,
    );
  });
});
