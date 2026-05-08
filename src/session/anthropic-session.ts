import Anthropic from '@anthropic-ai/sdk';
import {
  addUsage,
  emptyUsage,
  type Session,
  type SessionRequest,
  type SessionResponse,
  type SessionUsage,
} from './types';

/**
 * Default Sonnet model used by Phase 2. Tier matches `AnthropicExtractor`'s
 * default (also Sonnet) so the contract compiler and the run-time pipeline
 * share a cache prefix when run back-to-back.
 */
export const DEFAULT_SESSION_MODEL = 'claude-sonnet-4-6';

export interface AnthropicSessionOptions {
  /**
   * The static project-context prefix. Sent as a cached system block on every
   * call. Goes first; persona suffix and dynamic user content go last so the
   * cached prefix is reused across calls.
   */
  projectContext: string;
  /** API key. Falls back to env ANTHROPIC_API_KEY. */
  apiKey?: string;
  /** Default model id. Per-request override on `SessionRequest.model`. */
  model?: string;
  /** Inject a pre-built client (test seam). */
  client?: Anthropic;
}

/**
 * Production session manager. Holds a single Anthropic client and a static
 * project-context prefix that is sent as a cache-controlled system block on
 * every call. The cache breakpoint sits between the (cached) project context
 * and the (non-cached) per-persona suffix, which is the placement Anthropic's
 * documentation recommends for sessions with many short calls sharing one
 * long prefix.
 *
 * See `v8-overhaul-guide.md` §4.1 for the architectural rationale, §6 for the
 * cost model, and `v8-implementation-guide.md` §5 for Phase 2 scope.
 */
export class AnthropicSession implements Session {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly contextText: string;
  private cumulative: SessionUsage = emptyUsage();

  constructor(options: AnthropicSessionOptions) {
    this.client =
      options.client ??
      new Anthropic({
        apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
      });
    this.model = options.model ?? DEFAULT_SESSION_MODEL;
    this.contextText = options.projectContext;
  }

  projectContext(): string {
    return this.contextText;
  }

  totalUsage(): SessionUsage {
    return { ...this.cumulative };
  }

  async complete(request: SessionRequest): Promise<SessionResponse> {
    const model = request.model ?? this.model;
    const message = await this.client.messages.create({
      model,
      max_tokens: request.sampling.maxTokens,
      temperature: request.sampling.temperature,
      ...(request.sampling.topP !== undefined ? { top_p: request.sampling.topP } : {}),
      system: [
        {
          type: 'text',
          text: this.contextText,
          cache_control: { type: 'ephemeral' },
        },
        { type: 'text', text: request.personaSystemSuffix },
      ],
      messages: [{ role: 'user', content: request.userMessage }],
    });

    const usage = readAnthropicUsage(message.usage);
    this.cumulative = addUsage(this.cumulative, usage);

    return {
      text: extractText(message.content),
      usage,
      model: message.model,
      stopReason: message.stop_reason ?? null,
    };
  }
}

function extractText(content: Anthropic.ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'text') parts.push(block.text);
  }
  return parts.join('');
}

interface AnthropicUsageShape {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/**
 * Normalize an Anthropic `usage` payload into a SessionUsage. Anthropic
 * reports four fields; older SDKs may omit cache-* fields when the call
 * declined to cache, in which case we treat them as zero.
 */
export function readAnthropicUsage(u: AnthropicUsageShape | null | undefined): SessionUsage {
  return {
    inputTokens: numberOr(u?.input_tokens, 0),
    cacheReadTokens: numberOr(u?.cache_read_input_tokens, 0),
    cacheCreationTokens: numberOr(u?.cache_creation_input_tokens, 0),
    outputTokens: numberOr(u?.output_tokens, 0),
  };
}

function numberOr(v: number | null | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
