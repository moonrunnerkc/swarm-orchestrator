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
 * Backend for the Ollama daemon's native `/api/chat` endpoint. Streaming
 * uses Ollama's NDJSON format (one JSON object per line). Grammar-
 * constrained decoding is requested via the `format` field, which accepts
 * either the literal string `"json"` or a JSON Schema object — when the
 * caller passes a JSON Schema, Ollama enforces it during generation.
 *
 * Prefix-cache mapping: Ollama's KV cache is opaque from the client side
 * (no per-call hit/miss counts are reported). The backend always sets
 * `usageEstimated: false` when the server reports a usage block; the
 * cacheReadTokens field stays at zero because Ollama does not expose it.
 * Documenting the limitation so cost reports don't mislead.
 */
export class OllamaBackend implements LocalBackend {
  readonly name = 'ollama';
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: BackendOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.fetchImpl = options.fetch ?? fetch;
  }

  supportsGrammar(): readonly SupportedGrammar[] {
    return ['json-schema', 'none'];
  }

  async chat(request: BackendRequest): Promise<BackendResponse> {
    const body = buildOllamaBody(request, false);
    const response = await this.fetchWithTimeout('/api/chat', body);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`ollama backend /api/chat returned ${response.status}: ${truncate(text, 200)}`);
    }
    const parsed = safeParseJson(text) as
      | {
          message?: { content?: string; thinking?: string };
          prompt_eval_count?: number;
          eval_count?: number;
        }
      | null;
    // Some thinking-capable models ignore `think:false` and still route
    // their answer through `message.thinking` (or split it between the
    // two). Fall back to thinking when content is empty so the session
    // gets the model's actual output instead of an empty string.
    const content = parsed?.message?.content ?? '';
    const thinking = parsed?.message?.thinking ?? '';
    const text2 = content.length > 0 ? content : thinking;
    return {
      text: text2,
      usage: ollamaUsage(parsed),
      usageEstimated: parsed?.eval_count === undefined,
    };
  }

  async stream(
    request: BackendRequest,
    observer: BackendStreamObserver,
  ): Promise<BackendStreamResult> {
    const body = buildOllamaBody(request, true);
    const response = await this.fetchWithTimeout('/api/chat', body);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ollama backend stream failed (${response.status}): ${truncate(text, 200)}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('ollama backend stream: response has no body reader');

    const decoder = new TextDecoder('utf-8');
    let partialText = '';
    let buffered = '';
    let aborted = false;
    let finalUsage: BackendUsage = emptyBackendUsage();
    let usageEstimated = true;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const { lines, remaining } = splitLines(buffered);
      buffered = remaining;
      for (const line of lines) {
        if (line.trim().length === 0) continue;
        const parsed = safeParseJson(line) as
          | {
              message?: { content?: string; thinking?: string };
              done?: boolean;
              prompt_eval_count?: number;
              eval_count?: number;
            }
          | null;
        if (!parsed) continue;
        // Stream `content` deltas; only fall back to `thinking` deltas
        // when the model never produced any content (some thinking-
        // capable models ignore `think:false`).
        const contentDelta = parsed.message?.content ?? '';
        const thinkingDelta = parsed.message?.thinking ?? '';
        const delta = contentDelta.length > 0 ? contentDelta : thinkingDelta;
        if (delta.length > 0) {
          partialText += delta;
          if (!observer({ chunk: delta, partialText })) {
            aborted = true;
            try {
              await reader.cancel();
            } catch {
              // Cancellation is best-effort; an already-closed reader is fine.
            }
            break;
          }
        }
        if (parsed.done) {
          finalUsage = ollamaUsage(parsed);
          usageEstimated = parsed.eval_count === undefined;
        }
      }
      if (aborted) break;
    }
    return { text: partialText, usage: finalUsage, usageEstimated, aborted };
  }

  private async fetchWithTimeout(endpoint: string, body: unknown): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

function buildOllamaBody(request: BackendRequest, stream: boolean): Record<string, unknown> {
  // `think: false` tells Ollama not to route the model's output through a
  // separate `message.thinking` channel for models that support thinking
  // mode (gemma4, deepseek-r1, qwen3, gpt-oss). Without this, those models
  // happily fill `thinking` with their entire response and leave
  // `message.content` empty, which the session-side parser correctly
  // treats as an empty response. The caller can still re-enable thinking
  // by passing `extras: { think: true }`.
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    stream,
    think: false,
    options: {
      temperature: request.temperature,
      num_predict: request.maxTokens,
      ...(request.seed !== undefined && request.seed !== null ? { seed: request.seed } : {}),
      ...(request.stop && request.stop.length > 0 ? { stop: [...request.stop] } : {}),
    },
  };
  if (request.grammar?.kind === 'json-schema') {
    body.format = request.grammar.schema;
  }
  if (request.extras) Object.assign(body, request.extras);
  return body;
}

function ollamaUsage(
  parsed: { prompt_eval_count?: number; eval_count?: number } | null,
): BackendUsage {
  return {
    inputTokens: parsed?.prompt_eval_count ?? 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: parsed?.eval_count ?? 0,
  };
}

function splitLines(buffer: string): { lines: string[]; remaining: string } {
  const lines: string[] = [];
  let cursor = 0;
  while (cursor < buffer.length) {
    const newlineIdx = buffer.indexOf('\n', cursor);
    if (newlineIdx === -1) break;
    lines.push(buffer.slice(cursor, newlineIdx));
    cursor = newlineIdx + 1;
  }
  return { lines, remaining: buffer.slice(cursor) };
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
