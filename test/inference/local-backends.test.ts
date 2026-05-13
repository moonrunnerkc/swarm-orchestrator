import { strict as assert } from 'node:assert';
import { OpenAiCompatibleBackend } from '../../src/inference/local/backends/openai-compatible';
import { OllamaBackend } from '../../src/inference/local/backends/ollama';
import { LlamaCppBackend } from '../../src/inference/local/backends/llama-cpp';
import { VllmBackend } from '../../src/inference/local/backends/vllm';

/**
 * HTTP-boundary tests for each backend. The mock fetch captures the
 * outgoing request body, then returns a controlled response. These
 * exercise the request shape and the response parser without ever
 * touching a real server.
 */

interface MockCall {
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

function mockFetchReturning(json: unknown): { fetchImpl: typeof fetch; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k.toLowerCase()] = v;
      }
    }
    calls.push({
      url,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
      headers,
    });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(json),
      body: null,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function mockFetchErroring(status: number, body: string): typeof fetch {
  return (async () =>
    ({
      ok: false,
      status,
      text: async () => body,
    }) as unknown as Response) as unknown as typeof fetch;
}

describe('inference/local — OpenAiCompatibleBackend', () => {
  it('advertises json-schema grammar support', () => {
    const backend = new OpenAiCompatibleBackend({ baseUrl: 'http://x', fetch: mockFetchReturning({}).fetchImpl });
    assert.deepEqual([...backend.supportsGrammar()].sort(), ['json-schema', 'none']);
  });

  it('posts to /v1/chat/completions with the expected body and parses usage', async () => {
    const { fetchImpl, calls } = mockFetchReturning({
      choices: [{ message: { content: 'hello' } }],
      usage: { prompt_tokens: 12, completion_tokens: 3 },
    });
    const backend = new OpenAiCompatibleBackend({
      baseUrl: 'http://x/',
      apiKey: 'sk-test',
      fetch: fetchImpl,
    });
    const r = await backend.chat({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0,
      maxTokens: 32,
      seed: 7,
      grammar: { kind: 'json-schema', schema: { type: 'object' } },
    });
    assert.equal(r.text, 'hello');
    assert.equal(r.usage.inputTokens, 12);
    assert.equal(r.usage.outputTokens, 3);
    assert.equal(r.usageEstimated, false);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, 'http://x/v1/chat/completions');
    assert.equal(calls[0]!.headers.authorization, 'Bearer sk-test');
    const body = calls[0]!.body as Record<string, unknown>;
    assert.equal(body.model, 'm');
    assert.equal(body.temperature, 0);
    assert.equal(body.seed, 7);
    assert.ok(body.response_format, 'response_format should be set when grammar is json-schema');
  });

  it('surfaces a corrective message on HTTP errors', async () => {
    const backend = new OpenAiCompatibleBackend({
      baseUrl: 'http://x',
      fetch: mockFetchErroring(503, 'overloaded'),
    });
    await assert.rejects(
      () => backend.chat({ model: 'm', messages: [], temperature: 0, maxTokens: 32 }),
      /503.*overloaded/,
    );
  });
});

describe('inference/local — OllamaBackend', () => {
  it('advertises json-schema grammar support', () => {
    const backend = new OllamaBackend({ baseUrl: 'http://x', fetch: mockFetchReturning({}).fetchImpl });
    assert.deepEqual([...backend.supportsGrammar()].sort(), ['json-schema', 'none']);
  });

  it('posts to /api/chat with the expected body and parses usage', async () => {
    const { fetchImpl, calls } = mockFetchReturning({
      message: { content: 'hello' },
      prompt_eval_count: 20,
      eval_count: 5,
    });
    const backend = new OllamaBackend({ baseUrl: 'http://x', fetch: fetchImpl });
    const r = await backend.chat({
      model: 'llama-x',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0,
      maxTokens: 64,
      seed: 11,
      grammar: { kind: 'json-schema', schema: { type: 'object' } },
    });
    assert.equal(r.text, 'hello');
    assert.equal(r.usage.inputTokens, 20);
    assert.equal(r.usage.outputTokens, 5);
    assert.equal(r.usageEstimated, false);

    assert.equal(calls[0]!.url, 'http://x/api/chat');
    const body = calls[0]!.body as Record<string, unknown>;
    assert.equal(body.model, 'llama-x');
    assert.equal(body.stream, false);
    assert.deepEqual(body.format, { type: 'object' });
    const opts = body.options as Record<string, unknown>;
    assert.equal(opts.seed, 11);
    assert.equal(opts.num_predict, 64);
  });
});

describe('inference/local — LlamaCppBackend', () => {
  it('advertises gbnf grammar support', () => {
    const backend = new LlamaCppBackend({ baseUrl: 'http://x', fetch: mockFetchReturning({}).fetchImpl });
    assert.deepEqual([...backend.supportsGrammar()].sort(), ['gbnf', 'none']);
  });

  it('posts to /completion with the expected body and parses usage', async () => {
    const { fetchImpl, calls } = mockFetchReturning({
      content: 'no-op',
      tokens_evaluated: 30,
      tokens_predicted: 4,
    });
    const backend = new LlamaCppBackend({ baseUrl: 'http://x', fetch: fetchImpl });
    const r = await backend.chat({
      model: 'unused',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      temperature: 0,
      maxTokens: 32,
      grammar: { kind: 'gbnf', grammar: 'root ::= "no-op"' },
    });
    assert.equal(r.text, 'no-op');
    assert.equal(r.usage.inputTokens, 30);
    assert.equal(r.usage.outputTokens, 4);

    const body = calls[0]!.body as Record<string, unknown>;
    assert.equal(typeof body.prompt, 'string');
    assert.match(body.prompt as string, /### System\nsys/);
    assert.match(body.prompt as string, /### User\nhi/);
    assert.equal(body.grammar, 'root ::= "no-op"');
    assert.equal(body.cache_prompt, true);
  });
});

describe('inference/local — VllmBackend', () => {
  it('advertises json-schema grammar support', () => {
    const backend = new VllmBackend({ baseUrl: 'http://x', fetch: mockFetchReturning({}).fetchImpl });
    assert.deepEqual([...backend.supportsGrammar()].sort(), ['json-schema', 'none']);
  });

  it('posts to /v1/chat/completions with guided_json and parses cache hits', async () => {
    const { fetchImpl, calls } = mockFetchReturning({
      choices: [{ message: { content: 'hello' } }],
      usage: { prompt_tokens: 12, completion_tokens: 3, cached_tokens: 8 },
    });
    const backend = new VllmBackend({ baseUrl: 'http://x', fetch: fetchImpl });
    const r = await backend.chat({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0,
      maxTokens: 64,
      grammar: { kind: 'json-schema', schema: { type: 'object' } },
    });
    assert.equal(r.text, 'hello');
    assert.equal(r.usage.cacheReadTokens, 8);
    assert.equal(r.usage.inputTokens, 12);

    const body = calls[0]!.body as Record<string, unknown>;
    assert.deepEqual(body.guided_json, { type: 'object' });
  });
});
