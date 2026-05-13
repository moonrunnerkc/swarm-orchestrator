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
 * Backend for llama.cpp's native HTTP server (the `/completion` endpoint
 * shipped with `llama-server`). The endpoint accepts a prompt rather than a
 * messages array, so this backend renders the chat into the canonical
 * llama.cpp prompt format. Grammar-constrained decoding is supported via
 * the server's `grammar` field, which expects a GBNF string.
 *
 * The server's prefix cache (the `--cache-prompt` flag) is opaque from the
 * client side — the backend reports zero cacheReadTokens and documents the
 * limitation.
 */
export class LlamaCppBackend implements LocalBackend {
  readonly name = 'llama-cpp';
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: BackendOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.fetchImpl = options.fetch ?? fetch;
  }

  supportsGrammar(): readonly SupportedGrammar[] {
    return ['gbnf', 'none'];
  }

  async chat(request: BackendRequest): Promise<BackendResponse> {
    const body = buildLlamaCppBody(request, false);
    const response = await this.fetchWithTimeout('/completion', body);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `llama-cpp backend /completion returned ${response.status}: ${truncate(text, 200)}`,
      );
    }
    const parsed = safeParseJson(text) as
      | {
          content?: string;
          tokens_predicted?: number;
          tokens_evaluated?: number;
        }
      | null;
    const content = parsed?.content ?? '';
    return {
      text: content,
      usage: llamaCppUsage(parsed),
      usageEstimated: parsed?.tokens_predicted === undefined,
    };
  }

  async stream(
    request: BackendRequest,
    observer: BackendStreamObserver,
  ): Promise<BackendStreamResult> {
    const body = buildLlamaCppBody(request, true);
    const response = await this.fetchWithTimeout('/completion', body);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`llama-cpp backend stream failed (${response.status}): ${truncate(text, 200)}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('llama-cpp backend stream: response has no body reader');

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
        const parsed = safeParseJson(evt) as
          | {
              content?: string;
              stop?: boolean;
              tokens_predicted?: number;
              tokens_evaluated?: number;
            }
          | null;
        if (!parsed) continue;
        const delta = parsed.content ?? '';
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
        if (parsed.stop) {
          usage = llamaCppUsage(parsed);
          usageEstimated = parsed.tokens_predicted === undefined;
        }
      }
      if (aborted) break;
    }
    return { text: partialText, usage, usageEstimated, aborted };
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

function buildLlamaCppBody(request: BackendRequest, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: renderPrompt(request.messages),
    temperature: request.temperature,
    n_predict: request.maxTokens,
    stream,
    cache_prompt: true,
  };
  if (request.seed !== undefined && request.seed !== null) body.seed = request.seed;
  if (request.stop && request.stop.length > 0) body.stop = [...request.stop];
  if (request.grammar?.kind === 'gbnf') body.grammar = request.grammar.grammar;
  if (request.extras) Object.assign(body, request.extras);
  return body;
}

function renderPrompt(messages: readonly { role: string; content: string }[]): string {
  // Compose a minimal chat-style prompt. Servers typically apply the
  // model's actual chat template via Jinja before generation; passing a
  // role-tagged plain rendering is the lowest-common-denominator that
  // works across model families when the server template is absent.
  return messages
    .map((m) => {
      if (m.role === 'system') return `### System\n${m.content}`;
      if (m.role === 'user') return `### User\n${m.content}`;
      return `### Assistant\n${m.content}`;
    })
    .concat(['### Assistant\n'])
    .join('\n\n');
}

function llamaCppUsage(
  parsed: { tokens_predicted?: number; tokens_evaluated?: number } | null,
): BackendUsage {
  return {
    inputTokens: parsed?.tokens_evaluated ?? 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: parsed?.tokens_predicted ?? 0,
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
