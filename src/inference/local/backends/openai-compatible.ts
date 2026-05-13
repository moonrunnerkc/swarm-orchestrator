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
 * Backend for any OpenAI-compatible chat completions endpoint. Covers LM
 * Studio, LocalAI, Llamafile-server, llama.cpp's `--api` mode, vLLM's
 * OpenAI-compatible route, and any aggregator that speaks the same wire
 * format. The model id is whatever the server reports; nothing is
 * hardcoded.
 *
 * Grammar support: the backend advertises `json-schema` so the local
 * extractor can request structured output via `response_format` when the
 * server honors it. Servers that don't honor `response_format` simply
 * return prose; the caller falls back to soft-prompt parsing. The backend
 * does not silently retry — it surfaces the body it received.
 */
export class OpenAiCompatibleBackend implements LocalBackend {
  readonly name = 'openai-compatible';
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
    const body = buildChatRequestBody(request, false);
    const json = await this.postJson('/v1/chat/completions', body);
    return parseChatResponse(json);
  }

  async stream(
    request: BackendRequest,
    observer: BackendStreamObserver,
  ): Promise<BackendStreamResult> {
    const body = buildChatRequestBody(request, true);
    const response = await this.fetchWithTimeout('/v1/chat/completions', body);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `openai-compatible backend stream failed (${response.status}): ${truncate(text, 200)}`,
      );
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('openai-compatible backend stream: response has no body reader');
    }
    const decoder = new TextDecoder('utf-8');
    let partialText = '';
    let buffered = '';
    let aborted = false;
    let usage: BackendUsage = emptyBackendUsage();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const events = drainSseEvents(buffered);
      buffered = events.remaining;
      for (const evt of events.events) {
        if (evt === '[DONE]') continue;
        const parsed = safeParseJson(evt) as
          | {
              choices?: Array<{ delta?: { content?: string } }>;
              usage?: BackendUsage | null;
            }
          | null;
        if (!parsed) continue;
        const delta = parsed.choices?.[0]?.delta?.content ?? '';
        if (delta.length > 0) {
          partialText += delta;
          const keepGoing = observer({ chunk: delta, partialText });
          if (!keepGoing) {
            aborted = true;
            try {
              await reader.cancel();
            } catch {
              // The reader may already be closed; cancellation is best-effort.
            }
            break;
          }
        }
        if (parsed.usage) usage = parsed.usage;
      }
      if (aborted) break;
    }
    return {
      text: partialText,
      usage,
      usageEstimated: usage.inputTokens === 0 && usage.outputTokens === 0,
      aborted,
    };
  }

  private async postJson(endpoint: string, body: unknown): Promise<unknown> {
    const response = await this.fetchWithTimeout(endpoint, body);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `openai-compatible backend ${endpoint} returned ${response.status}: ${truncate(text, 200)}`,
      );
    }
    return safeParseJson(text);
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

function buildChatRequestBody(request: BackendRequest, stream: boolean): Record<string, unknown> {
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
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'response', schema: request.grammar.schema, strict: true },
    };
  }
  if (request.extras) Object.assign(body, request.extras);
  return body;
}

function parseChatResponse(json: unknown): BackendResponse {
  const obj = json as
    | {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          prompt_cache_hit_tokens?: number;
          prompt_cache_miss_tokens?: number;
        };
      }
    | null;
  const text = obj?.choices?.[0]?.message?.content ?? '';
  const u = obj?.usage ?? {};
  const usage: BackendUsage = {
    inputTokens: u.prompt_tokens ?? 0,
    cacheReadTokens: u.prompt_cache_hit_tokens ?? 0,
    cacheCreationTokens: 0,
    outputTokens: u.completion_tokens ?? 0,
  };
  const usageEstimated = usage.inputTokens === 0 && usage.outputTokens === 0;
  return { text, usage, usageEstimated };
}

interface DrainResult {
  events: string[];
  remaining: string;
}

function drainSseEvents(buffer: string): DrainResult {
  // OpenAI-style SSE: `data: <json>\n\n` per event. Some servers omit the
  // blank line between events; we handle both by splitting on either form.
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
