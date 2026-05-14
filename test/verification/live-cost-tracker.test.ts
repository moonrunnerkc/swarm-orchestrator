import { strict as assert } from 'assert';
import {
  LiveCostTracker,
  COST_CAP_ABORT_REASON,
} from '../../src/verification/live-cost-tracker';

const ZERO = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
};

describe('LiveCostTracker', () => {
  it('reports no budget when constructed with budgetTokens=null', () => {
    const t = new LiveCostTracker({ budgetTokens: null });
    assert.equal(t.hasBudget(), false);
    assert.equal(t.isCancelled(), false);
  });

  it('does not abort when projected tokens stay under budget', () => {
    const t = new LiveCostTracker({ budgetTokens: 10_000 });
    const { observer, finalize } = t.observerForStream();
    const decision = observer({ partialText: 'a'.repeat(100), chunk: '', charsObserved: 100 });
    assert.equal(decision.kind, 'continue');
    finalize({ ...ZERO, outputTokens: 25 });
    assert.equal(t.isCancelled(), false);
  });

  it('aborts the stream once projected tokens cross the budget', () => {
    // estimateTokens uses ~4 chars/token; 2000 chars ≈ 500 tokens, above a 50-token budget.
    const t = new LiveCostTracker({ budgetTokens: 50 });
    const { observer } = t.observerForStream();
    const text = 'x'.repeat(2000);
    const decision = observer({ partialText: text, chunk: '', charsObserved: (text).length });
    assert.equal(decision.kind, 'abort');
    if (decision.kind === 'abort') assert.equal(decision.reason, COST_CAP_ABORT_REASON);
    assert.equal(t.isCancelled(), true);
    const info = t.lastAbortInfo();
    assert.ok(info !== null);
    assert.equal(info?.budgetTokens, 50);
    assert.ok((info?.projectedTokens ?? 0) >= 50);
  });

  it('accounts for multiple concurrent streams against the same ceiling', () => {
    // 150 chars ≈ 38 tokens — one stream stays under 50-token budget; two combined cross it.
    const t = new LiveCostTracker({ budgetTokens: 50 });
    const a = t.observerForStream();
    const b = t.observerForStream();
    const aDec = a.observer({ partialText: 'x'.repeat(150), chunk: '', charsObserved: 150 });
    assert.equal(aDec.kind, 'continue');
    const bDec = b.observer({ partialText: 'y'.repeat(150), chunk: '', charsObserved: 150 });
    assert.equal(bDec.kind, 'abort');
  });

  it('finalize commits usage and frees in-flight slot', () => {
    const t = new LiveCostTracker({ budgetTokens: null });
    const { observer, finalize } = t.observerForStream();
    observer({ partialText: 'abcde', chunk: '', charsObserved: ('abcde').length });
    assert.ok(t.projectedTokens() > 0);
    finalize({ ...ZERO, outputTokens: 10 });
    assert.equal(t.projectedTokens(), t.committedTokens());
    assert.equal(t.committedTokens(), 10);
  });

  it('inner observer abort decision is preserved when budget is intact', () => {
    const t = new LiveCostTracker({ budgetTokens: 100_000 });
    const { observer } = t.observerForStream((ev) =>
      ev.partialText.includes('STOP') ? { kind: 'abort', reason: 'inner-stop' } : { kind: 'continue' },
    );
    const cont = observer({ partialText: 'all good', chunk: '', charsObserved: ('all good').length });
    assert.equal(cont.kind, 'continue');
    const stop = observer({ partialText: 'STOP now', chunk: '', charsObserved: ('STOP now').length });
    assert.equal(stop.kind, 'abort');
    if (stop.kind === 'abort') assert.equal(stop.reason, 'inner-stop');
  });

  it('budget abort takes precedence over inner observer', () => {
    const t = new LiveCostTracker({ budgetTokens: 10 });
    let innerCalled = false;
    const { observer } = t.observerForStream(() => {
      innerCalled = true;
      return { kind: 'continue' };
    });
    const dec = observer({ partialText: 'x'.repeat(5000), chunk: '', charsObserved: 5000 });
    assert.equal(dec.kind, 'abort');
    if (dec.kind === 'abort') assert.equal(dec.reason, COST_CAP_ABORT_REASON);
    assert.equal(innerCalled, false);
  });

  it('snapshot reports committed, projected, and budget', () => {
    const t = new LiveCostTracker({ budgetTokens: 5000 });
    const { observer, finalize } = t.observerForStream();
    observer({ partialText: 'hello world', chunk: '', charsObserved: ('hello world').length });
    const s = t.snapshot();
    assert.equal(s.budgetTokens, 5000);
    assert.ok(s.projectedTokens >= s.committedTokens);
    finalize({ ...ZERO, outputTokens: 4 });
  });
});
