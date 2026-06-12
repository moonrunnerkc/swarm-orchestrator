import { strict as assert } from 'assert';
import {
  BoundedSession,
  BudgetExceededError,
} from '../../src/session/bounded-session';
import type {
  Session,
  SessionRequest,
  SessionResponse,
  SessionStreamObserver,
  SessionStreamResult,
  SessionUsage,
  ProviderInfo,
} from '../../src/session/types';
import { emptyUsage } from '../../src/session/types';

class CountingSession implements Session {
  public completeCalls = 0;
  public streamCalls = 0;

  constructor(private readonly outputPerCall: number = 100) {}

  async complete(_req: SessionRequest): Promise<SessionResponse> {
    this.completeCalls += 1;
    return {
      text: 'ok',
      usage: { ...emptyUsage(), outputTokens: this.outputPerCall },
      model: 'stub',
      stopReason: 'end_turn',
    };
  }

  async stream(
    _req: SessionRequest,
    _observer: SessionStreamObserver,
  ): Promise<SessionStreamResult> {
    this.streamCalls += 1;
    return {
      response: {
        text: 'ok',
        usage: { ...emptyUsage(), outputTokens: this.outputPerCall },
        model: 'stub',
        stopReason: 'end_turn',
      },
      aborted: false,
      abortReason: null,
    };
  }

  totalUsage(): SessionUsage {
    return emptyUsage();
  }

  providerInfo(): ProviderInfo {
    return {
      provider: 'stub',
      model: 'stub',
      backend: null,
      grammar: null,
      seed: null,
      usageEstimated: false,
    };
  }

  projectContext(): string {
    return '';
  }
}

function aRequest(): SessionRequest {
  return {
    personaId: 'p',
    personaSystemSuffix: '',
    sampling: { temperature: 0, maxTokens: 100 },
    userMessage: 'hi',
  };
}

describe('session/bounded-session', () => {
  it('passes calls through to the inner session when within budget', async () => {
    const inner = new CountingSession();
    const bounded = new BoundedSession(inner, { maxCalls: 5, maxOutputTokens: null });
    const r1 = await bounded.complete(aRequest());
    const r2 = await bounded.complete(aRequest());
    assert.equal(r1.text, 'ok');
    assert.equal(r2.text, 'ok');
    assert.equal(inner.completeCalls, 2);
    assert.equal(bounded.remainingCalls(), 3);
  });

  it('throws BudgetExceededError once the call ceiling is crossed', async () => {
    const inner = new CountingSession();
    const bounded = new BoundedSession(inner, { maxCalls: 2, maxOutputTokens: null });
    await bounded.complete(aRequest());
    await bounded.complete(aRequest());
    await assert.rejects(
      () => bounded.complete(aRequest()),
      (err: Error) => {
        assert.ok(err instanceof BudgetExceededError);
        assert.equal((err as BudgetExceededError).kind, 'calls');
        assert.equal((err as BudgetExceededError).limit, 2);
        return true;
      },
    );
  });

  it('throws BudgetExceededError once the output-token ceiling is crossed', async () => {
    const inner = new CountingSession(60);
    const bounded = new BoundedSession(inner, { maxCalls: null, maxOutputTokens: 100 });
    // First call adds 60, still under 100 — succeeds.
    await bounded.complete(aRequest());
    // Second call sees outputSoFar=60 < 100, still succeeds.
    await bounded.complete(aRequest());
    // Now outputSoFar=120, the third call fails before reaching the inner.
    await assert.rejects(
      () => bounded.complete(aRequest()),
      (err: Error) => {
        assert.ok(err instanceof BudgetExceededError);
        assert.equal((err as BudgetExceededError).kind, 'output-tokens');
        return true;
      },
    );
  });

  it('counts stream() calls against the same budget as complete()', async () => {
    const inner = new CountingSession();
    const bounded = new BoundedSession(inner, { maxCalls: 2, maxOutputTokens: null });
    await bounded.stream(aRequest(), () => ({ kind: 'continue' }));
    await bounded.complete(aRequest());
    await assert.rejects(
      () => bounded.stream(aRequest(), () => ({ kind: 'continue' })),
      BudgetExceededError,
    );
  });

  it('returns null remaining when budgets are uncapped', () => {
    const inner = new CountingSession();
    const bounded = new BoundedSession(inner, { maxCalls: null, maxOutputTokens: null });
    assert.equal(bounded.remainingCalls(), null);
    assert.equal(bounded.remainingOutputTokens(), null);
  });
});
