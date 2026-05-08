import { strict as assert } from 'assert';
import { StubSession, estimateTokens } from '../../src/session/stub-session';

describe('session/StubSession', () => {
  it('first call records cache-write tokens; subsequent calls record cache-read', async () => {
    const ctx = 'A'.repeat(400); // ~100 tokens
    const session = new StubSession({ projectContext: ctx });

    const first = await session.complete({
      personaId: 'p',
      personaSystemSuffix: 'suffix',
      sampling: { temperature: 0, maxTokens: 64 },
      userMessage: 'hello',
    });
    assert.ok(first.usage.cacheCreationTokens > 0);
    assert.equal(first.usage.cacheReadTokens, 0);

    const second = await session.complete({
      personaId: 'p',
      personaSystemSuffix: 'suffix',
      sampling: { temperature: 0, maxTokens: 64 },
      userMessage: 'hello',
    });
    assert.equal(second.usage.cacheCreationTokens, 0);
    assert.ok(second.usage.cacheReadTokens > 0);
    assert.equal(second.usage.cacheReadTokens, first.usage.cacheCreationTokens);
  });

  it('responder receives request and call index', async () => {
    const seen: Array<{ id: string; idx: number }> = [];
    const session = new StubSession({
      projectContext: '',
      responder: (req, idx) => {
        seen.push({ id: req.personaId, idx });
        return `response-${idx}`;
      },
    });
    const r1 = await session.complete({
      personaId: 'a',
      personaSystemSuffix: '',
      sampling: { temperature: 0, maxTokens: 1 },
      userMessage: '',
    });
    const r2 = await session.complete({
      personaId: 'b',
      personaSystemSuffix: '',
      sampling: { temperature: 0, maxTokens: 1 },
      userMessage: '',
    });
    assert.equal(r1.text, 'response-0');
    assert.equal(r2.text, 'response-1');
    assert.deepEqual(seen, [
      { id: 'a', idx: 0 },
      { id: 'b', idx: 1 },
    ]);
  });

  it('cumulative totalUsage matches the sum of per-call usages', async () => {
    const session = new StubSession({ projectContext: 'ctx' });
    const a = await session.complete({
      personaId: 'p',
      personaSystemSuffix: '',
      sampling: { temperature: 0, maxTokens: 1 },
      userMessage: 'one',
    });
    const b = await session.complete({
      personaId: 'p',
      personaSystemSuffix: '',
      sampling: { temperature: 0, maxTokens: 1 },
      userMessage: 'two',
    });
    const total = session.totalUsage();
    assert.equal(total.inputTokens, a.usage.inputTokens + b.usage.inputTokens);
    assert.equal(total.outputTokens, a.usage.outputTokens + b.usage.outputTokens);
    assert.equal(total.cacheReadTokens, b.usage.cacheReadTokens);
    assert.equal(total.cacheCreationTokens, a.usage.cacheCreationTokens);
  });

  it('estimateTokens follows the 4-chars-per-token heuristic', () => {
    assert.equal(estimateTokens(''), 0);
    assert.equal(estimateTokens('abcd'), 1);
    assert.equal(estimateTokens('abcde'), 2);
    assert.equal(estimateTokens('a'.repeat(400)), 100);
  });
});
