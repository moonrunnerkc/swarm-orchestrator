/**
 * Type definitions for the v8 session layer. A "session" is a long-lived
 * inference connection that hosts multiple personas and shares a static
 * project-context prefix across calls so prompt-cache reads dominate input
 * cost. See `v8-overhaul-guide.md` §4.1 (CLI subprocess → shared inference
 * session) and `v8-implementation-guide.md` §5 (Phase 2 deliverable).
 */

/** Token usage as reported by the inference provider on a single call. */
export interface SessionUsage {
  /** Input tokens billed at standard input rate. */
  inputTokens: number;
  /** Input tokens that hit a warm cache (billed at the cache-read rate). */
  cacheReadTokens: number;
  /** Input tokens written into the cache on this call (billed at the cache-write rate). */
  cacheCreationTokens: number;
  /** Output tokens billed at standard output rate. */
  outputTokens: number;
}

/** Zero-initialized SessionUsage. */
export function emptyUsage(): SessionUsage {
  return {
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
  };
}

/** Componentwise sum of usage records. */
export function addUsage(a: SessionUsage, b: SessionUsage): SessionUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}

/**
 * Anthropic-published prompt-cache pricing multipliers, applied to whatever
 * the model's standard-input rate is. Cache-read = 0.1×, cache-write = 1.25×.
 * See https://docs.claude.com/en/docs/build-with-claude/prompt-caching.
 *
 * Stored as constants here so the benchmark harness and the run-time UI both
 * compute "effective input tokens" with the same multipliers. Callers that
 * need a dollar figure multiply by the model's actual input price.
 */
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;

/**
 * "Effective input tokens" — input tokens normalized to standard-rate equivalents
 * using the Anthropic cache multipliers. This is the comparable cost surface
 * for v6 (no caching) vs v8 (caching) numbers.
 */
export function effectiveInputTokens(u: SessionUsage): number {
  return (
    u.inputTokens +
    u.cacheReadTokens * CACHE_READ_MULTIPLIER +
    u.cacheCreationTokens * CACHE_WRITE_MULTIPLIER
  );
}

/**
 * Cache hit rate in [0, 1]: cache-read tokens divided by total input-side
 * tokens (read + write + non-cached). Returns 0 when no input tokens flowed.
 */
export function cacheHitRate(u: SessionUsage): number {
  const total = u.inputTokens + u.cacheReadTokens + u.cacheCreationTokens;
  if (total === 0) return 0;
  return u.cacheReadTokens / total;
}

/**
 * A persona-shaped completion request the session manager understands.
 * Persona-specific bits (system slice, sampling regime, tier) come from the
 * persona registry; dynamic per-call content is supplied by the caller.
 */
export interface SessionRequest {
  /** Persona id, used by the session for logging and tier dispatch. */
  personaId: string;
  /** Persona-specific system-prompt suffix (NON-cached, per-call). */
  personaSystemSuffix: string;
  /** Sampling regime for this call. */
  sampling: { temperature: number; maxTokens: number; topP?: number };
  /** Model id override. When omitted, the session uses its default. */
  model?: string;
  /**
   * Dynamic per-call user-message content. Placed last so the cached prefix
   * stays intact across calls.
   */
  userMessage: string;
}

/** Provider response, normalized. */
export interface SessionResponse {
  /** Concatenated text output (assistant turn). */
  text: string;
  /** Token usage reported by the provider. */
  usage: SessionUsage;
  /** Model id the call actually ran against. */
  model: string;
  /** Stop reason ('end_turn', 'max_tokens', 'tool_use', 'stop_sequence', etc.). */
  stopReason: string | null;
}

/**
 * Phase 6 streaming primitives. The streaming verifier (see
 * `src/verification/streaming-verifier.ts`) observes partial output as it
 * arrives and may signal early abort when a contract violation is
 * detected. The session's `stream` method is the substrate for that
 * observation.
 */
export type StreamDecision = { kind: 'continue' } | { kind: 'abort'; reason: string };

/** A single observation point during a streaming completion. */
export interface SessionStreamEvent {
  /** Accumulated text so far. */
  partialText: string;
  /** The new chunk appended in this event. */
  chunk: string;
  /** Total character count of `partialText`. */
  charsObserved: number;
}

/**
 * Streaming observer the session calls on each text chunk. Returning
 * `{ kind: 'abort', reason }` cancels the in-flight generation; the
 * session settles by returning a `SessionStreamResult` with `aborted: true`.
 */
export type SessionStreamObserver = (event: SessionStreamEvent) => StreamDecision;

/** Result of a streaming completion call. */
export interface SessionStreamResult {
  /**
   * The provider response. When `aborted` is true, `text` is the partial
   * text observed up to abort and `usage` reflects tokens billed up to
   * that point. When `aborted` is false, `text` and `usage` match the
   * non-streaming `complete()` shape.
   */
  response: SessionResponse;
  /** True when the observer aborted the stream. */
  aborted: boolean;
  /** Reason the observer gave for aborting, or null when not aborted. */
  abortReason: string | null;
}

/**
 * Provider attribution recorded in the ledger alongside every call this
 * session produces. The fields are populated at construction time and do
 * not change between calls; the ledger writer copies them into each
 * provider-attributed entry so audits can reconstruct which provider /
 * model / backend produced a given candidate.
 */
export interface ProviderInfo {
  /** One of the three providers; "stub" is the heuristic back-compat alias. */
  provider: 'deterministic' | 'local' | 'anthropic' | 'stub';
  /** Model id, or null for providers that don't run a model. */
  model: string | null;
  /** Local-backend name (ollama / openai-compatible / llama-cpp / vllm), or null. */
  backend: string | null;
  /** Grammar-decoding mode in effect (gbnf / json-schema / outlines / none), or null. */
  grammar: string | null;
  /** Sampling seed, when applicable. */
  seed: number | null;
  /** True when the backend doesn't report token counts and the session estimates. */
  usageEstimated: boolean;
}

/**
 * The session abstraction. Three implementations satisfy this interface:
 * DeterministicSession (default; no model; emits externally-sourced
 * patches from a directory, queue file, or stdin), LocalSession (any
 * OpenAI-compatible / Ollama / llama.cpp / vLLM endpoint), and
 * AnthropicSession (real API, prompt-cache-native). The session's caller
 * (run-handler, orchestrator) treats all three identically.
 */
export interface Session {
  /** Run a persona-shaped completion. */
  complete(request: SessionRequest): Promise<SessionResponse>;
  /** Cumulative usage across every call this session has served. */
  totalUsage(): SessionUsage;
  /** Provider attribution for the ledger; constant across the session's life. */
  providerInfo(): ProviderInfo;
  /**
   * Static project-context prefix the session prepends to every call. Public
   * so callers and tests can introspect what is being cached.
   */
  projectContext(): string;
  /**
   * Phase 6: streaming variant. The session emits text chunks to the
   * observer; returning `{ kind: 'abort', reason }` from the observer
   * cancels generation early and the result reflects tokens billed up to
   * the abort point. Implementations that don't natively stream may
   * simulate it by chunking a non-streaming response.
   */
  stream(
    request: SessionRequest,
    observer: SessionStreamObserver,
  ): Promise<SessionStreamResult>;
}
