import { strict as assert } from 'assert';
import {
  LiveCostTracker,
  COST_CAP_ABORT_REASON,
  SONNET4_PRICE_PER_TOKEN,
} from '../../src/verification/live-cost-tracker';

const ZERO = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
};

describe('LiveCostTracker', () => {
  it('reports no cap when constructed with capUsd=null', () => {
    const t = new LiveCostTracker({ capUsd: null });
    assert.equal(t.hasCap(), false);
    assert.equal(t.isCancelled(), false);
  });

  it('does not abort when projected spend stays under cap', () => {
    const t = new LiveCostTracker({ capUsd: 10 });
    const { observer, finalize } = t.observerForStream();
    const decision = observer({ partialText: 'a'.repeat(100), chunk: '', charsObserved: 100 });
    assert.equal(decision.kind, 'continue');
    finalize({ ...ZERO, outputTokens: 25 });
    assert.equal(t.isCancelled(), false);
  });

  it('aborts the stream once projected spend crosses the cap', () => {
    // Sonnet 4 output: $0.000015/token. To hit a $0.001 cap we need ~67 tokens (~268 chars).
    const t = new LiveCostTracker({ capUsd: 0.001 });
    const { observer } = t.observerForStream();
    const text = 'x'.repeat(2000);
    const decision = observer({ partialText: text, chunk: '', charsObserved: (text).length });
    assert.equal(decision.kind, 'abort');
    if (decision.kind === 'abort') assert.equal(decision.reason, COST_CAP_ABORT_REASON);
    assert.equal(t.isCancelled(), true);
    const info = t.lastAbortInfo();
    assert.ok(info !== null);
    assert.equal(info?.capUsd, 0.001);
    assert.ok((info?.projectedUsd ?? 0) >= 0.001);
  });

  it('accounts for multiple concurrent streams against the same ceiling', () => {
    const t = new LiveCostTracker({ capUsd: 0.001 });
    const a = t.observerForStream();
    const b = t.observerForStream();
    // 150 chars ≈ 38 tokens ≈ $0.00057 — single stream is under $0.001 cap.
    const aDec = a.observer({ partialText: 'x'.repeat(150), chunk: '', charsObserved: 150 });
    assert.equal(aDec.kind, 'continue');
    // Combined ≈ $0.00114 — second stream pushes projected over cap.
    const bDec = b.observer({ partialText: 'y'.repeat(150), chunk: '', charsObserved: 150 });
    assert.equal(bDec.kind, 'abort');
  });

  it('finalize commits usage and frees in-flight slot', () => {
    const t = new LiveCostTracker({ capUsd: null });
    const { observer, finalize } = t.observerForStream();
    observer({ partialText: 'abcde', chunk: '', charsObserved: ('abcde').length });
    assert.ok(t.projectedUsd() > 0);
    finalize({ ...ZERO, outputTokens: 10 });
    // After finalize, no in-flight estimate; projected = committed.
    assert.equal(t.projectedUsd(), t.spentUsd());
    assert.equal(t.spentUsd(), 10 * SONNET4_PRICE_PER_TOKEN.output);
  });

  it('inner observer abort decision is preserved when cap is intact', () => {
    const t = new LiveCostTracker({ capUsd: 100 });
    const { observer } = t.observerForStream((ev) =>
      ev.partialText.includes('STOP') ? { kind: 'abort', reason: 'inner-stop' } : { kind: 'continue' },
    );
    const cont = observer({ partialText: 'all good', chunk: '', charsObserved: ('all good').length });
    assert.equal(cont.kind, 'continue');
    const stop = observer({ partialText: 'STOP now', chunk: '', charsObserved: ('STOP now').length });
    assert.equal(stop.kind, 'abort');
    if (stop.kind === 'abort') assert.equal(stop.reason, 'inner-stop');
  });

  it('cap abort takes precedence over inner observer', () => {
    const t = new LiveCostTracker({ capUsd: 0.0001 });
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

  it('snapshot reports committed, projected, and cap', () => {
    const t = new LiveCostTracker({ capUsd: 5 });
    const { observer, finalize } = t.observerForStream();
    observer({ partialText: 'hello world', chunk: '', charsObserved: ('hello world').length });
    const s = t.snapshot();
    assert.equal(s.capUsd, 5);
    assert.ok(s.projectedUsd >= s.committedUsd);
    finalize({ ...ZERO, outputTokens: 4 });
  });
});
