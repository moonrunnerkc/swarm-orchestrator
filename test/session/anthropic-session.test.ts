import { strict as assert } from 'assert';
import { AnthropicSession, readAnthropicUsage } from '../../src/session/anthropic-session';

interface CapturedCall {
  model: string;
  system: unknown;
  messages: unknown;
  temperature: number;
  max_tokens: number;
  top_p?: number;
}

function fakeClient(responder: (call: CapturedCall) => unknown): {
  client: { messages: { create: (args: CapturedCall) => Promise<unknown> } };
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const client = {
    messages: {
      create: async (args: CapturedCall): Promise<unknown> => {
        calls.push(args);
        return responder(args);
      },
    },
  };
  return { client, calls };
}

describe('session/AnthropicSession', () => {
  it('places project context as a cache_control system block, persona suffix after', async () => {
    const { client, calls } = fakeClient(() => ({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 100 },
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
    }));
    const session = new AnthropicSession({
      client: client as any,
      projectContext: 'PROJECT_CTX',
      apiKey: 'k',
    });

    await session.complete({
      personaId: 'architect',
      personaSystemSuffix: 'SUFFIX',
      sampling: { temperature: 0.2, maxTokens: 100 },
      userMessage: 'hello',
    });

    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call);
    assert.ok(Array.isArray(call.system));
    const system = call.system as Array<{ text: string; cache_control?: { type: string } }>;
    assert.equal(system.length, 2);
    assert.equal(system[0]?.text, 'PROJECT_CTX');
    assert.deepEqual(system[0]?.cache_control, { type: 'ephemeral' });
    assert.equal(system[1]?.text, 'SUFFIX');
    // Persona suffix block is NOT cache-controlled (per-call dynamic).
    assert.equal(system[1]?.cache_control, undefined);
  });

  it('accumulates totalUsage across calls', async () => {
    const responses = [
      {
        content: [{ type: 'text', text: 'a' }],
        usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 100 },
        model: 'm',
        stop_reason: 'end_turn',
      },
      {
        content: [{ type: 'text', text: 'b' }],
        usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
        model: 'm',
        stop_reason: 'end_turn',
      },
    ];
    let i = 0;
    const { client } = fakeClient(() => responses[i++]);
    const session = new AnthropicSession({
      client: client as any,
      projectContext: 'CTX',
      apiKey: 'k',
    });
    await session.complete({
      personaId: 'a',
      personaSystemSuffix: '',
      sampling: { temperature: 0, maxTokens: 1 },
      userMessage: '',
    });
    await session.complete({
      personaId: 'a',
      personaSystemSuffix: '',
      sampling: { temperature: 0, maxTokens: 1 },
      userMessage: '',
    });
    const total = session.totalUsage();
    assert.equal(total.inputTokens, 10);
    assert.equal(total.outputTokens, 2);
    assert.equal(total.cacheCreationTokens, 100);
    assert.equal(total.cacheReadTokens, 100);
  });

  it('readAnthropicUsage tolerates missing or null cache fields', () => {
    assert.deepEqual(readAnthropicUsage(undefined), {
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
    });
    assert.deepEqual(readAnthropicUsage({ input_tokens: 1, output_tokens: 2 }), {
      inputTokens: 1,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 2,
    });
    assert.deepEqual(
      readAnthropicUsage({
        input_tokens: 1,
        output_tokens: 2,
        cache_read_input_tokens: null,
        cache_creation_input_tokens: null,
      }),
      { inputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 2 },
    );
  });

  it('respects per-request model override', async () => {
    const { client, calls } = fakeClient(() => ({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'override',
      stop_reason: 'end_turn',
    }));
    const session = new AnthropicSession({
      client: client as any,
      projectContext: '',
      apiKey: 'k',
      model: 'default',
    });
    await session.complete({
      personaId: 'a',
      personaSystemSuffix: '',
      sampling: { temperature: 0, maxTokens: 1 },
      userMessage: 'x',
      model: 'override',
    });
    assert.equal(calls[0]?.model, 'override');
  });
});
