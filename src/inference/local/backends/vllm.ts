import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  emptyBackendUsage,
  type BackendOptions,
  type BackendRequest,
  type BackendResponse,
  type BackendStreamObserver,
  type BackendStreamResult,
  type BackendUsage,
  type LocalBackend,
  type SupportedGrammar,
} from '../backend';

/**
 * Backend for vLLM's OpenAI-compatible HTTP server. vLLM accepts the same
 * `/v1/chat/completions` shape as the {@link OpenAiCompatibleBackend}, plus
 * a `guided_json` extras field for grammar-constrained decoding against a
 * JSON Schema. The OpenAI-compatible response_format path is also supported
 * by recent vLLM builds; this backend prefers `guided_json` because it has
 * been the stable surface across versions.
 *
 * Prefix-cache mapping: vLLM honors `enable_prefix_caching` at server
 * startup. When enabled, the server reports `cached_tokens` in the usage
 * block — the backend surfaces that as `cacheReadTokens` for the cost
 * model.
 */
export class VllmBackend implements LocalBackend {
  readonly name = 'vllm';
  private readonly baseUrl: string;
  private readonly apiKey: string | null;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: BackendOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey ?? null;
    this.timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.fetchImpl = options.fetch ?? fetch;
  }

  supportsGrammar(): readonly SupportedGrammar[] {
    return ['json-schema', 'none'];
  }

  async chat(request: BackendRequest): Promise<BackendResponse> {
    const body = buildVllmBody(request, false);
    const response = await this.fetchWithTimeout('/v1/chat/completions', body);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `vllm backend /v1/chat/completions returned ${response.status}: ${truncate(text, 200)}`,
      );
    }
    const parsed = safeParseJson(text) as
      | {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            cached_tokens?: number;
          };
        }
      | null;
    const content = parsed?.choices?.[0]?.message?.content ?? '';
    return {
      text: content,
      usage: vllmUsage(parsed?.usage),
      usageEstimated: parsed?.usage?.completion_tokens === undefined,
    };
  }

  async stream(
    request: BackendRequest,
    observer: BackendStreamObserver,
  ): Promise<BackendStreamResult> {
    const body = buildVllmBody(request, true);
    const response = await this.fetchWithTimeout('/v1/chat/completions', body);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`vllm backend stream failed (${response.status}): ${truncate(text, 200)}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('vllm backend stream: response has no body reader');

    const decoder = new TextDecoder('utf-8');
    let partialText = '';
    let buffered = '';
    let aborted = false;
    let usage: BackendUsage = emptyBackendUsage();
    let usageEstimated = true;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const { events, remaining } = drainSseEvents(buffered);
      buffered = remaining;
      for (const evt of events) {
        if (evt === '[DONE]') continue;
        const parsed = safeParseJson(evt) as
          | {
              choices?: Array<{ delta?: { content?: string } }>;
              usage?: { prompt_tokens?: number; completion_tokens?: number; cached_tokens?: number };
            }
          | null;
        if (!parsed) continue;
        const delta = parsed.choices?.[0]?.delta?.content ?? '';
        if (delta.length > 0) {
          partialText += delta;
          if (!observer({ chunk: delta, partialText })) {
            aborted = true;
            try {
              await reader.cancel();
            } catch {
              // Cancellation is best-effort.
            }
            break;
          }
        }
        if (parsed.usage) {
          usage = vllmUsage(parsed.usage);
          usageEstimated = parsed.usage.completion_tokens === undefined;
        }
      }
      if (aborted) break;
    }
    return { text: partialText, usage, usageEstimated, aborted };
  }

  private async fetchWithTimeout(endpoint: string, body: unknown): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    try {
      return await this.fetchImpl(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

function buildVllmBody(request: BackendRequest, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    temperature: request.temperature,
    max_tokens: request.maxTokens,
    stream,
  };
  if (request.seed !== undefined && request.seed !== null) body.seed = request.seed;
  if (request.stop && request.stop.length > 0) body.stop = [...request.stop];
  if (request.grammar?.kind === 'json-schema') {
    body.guided_json = request.grammar.schema;
  }
  if (request.extras) Object.assign(body, request.extras);
  return body;
}

function vllmUsage(
  u:
    | { prompt_tokens?: number; completion_tokens?: number; cached_tokens?: number }
    | undefined,
): BackendUsage {
  return {
    inputTokens: u?.prompt_tokens ?? 0,
    cacheReadTokens: u?.cached_tokens ?? 0,
    cacheCreationTokens: 0,
    outputTokens: u?.completion_tokens ?? 0,
  };
}

function drainSseEvents(buffer: string): { events: string[]; remaining: string } {
  const events: string[] = [];
  let cursor = 0;
  while (cursor < buffer.length) {
    const newlineIdx = buffer.indexOf('\n', cursor);
    if (newlineIdx === -1) break;
    const line = buffer.slice(cursor, newlineIdx).trimEnd();
    cursor = newlineIdx + 1;
    if (line.startsWith('data:')) {
      events.push(line.slice('data:'.length).trim());
    }
  }
  return { events, remaining: buffer.slice(cursor) };
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}
