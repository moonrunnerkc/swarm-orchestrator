// A "session" is a long-lived inference connection that shares a static
// project-context prefix across calls so prompt-cache reads dominate
// input cost.

export interface SessionUsage {
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
}

export function emptyUsage(): SessionUsage {
  return {
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
  };
}

export function addUsage(a: SessionUsage, b: SessionUsage): SessionUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}

// Anthropic-published prompt-cache pricing multipliers, applied to the
// model's standard input rate. Cache-read = 0.1×, cache-write = 1.25×.
// https://docs.claude.com/en/docs/build-with-claude/prompt-caching
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;

// Input tokens normalized to standard-rate equivalents using the
// Anthropic cache multipliers.
export function effectiveInputTokens(u: SessionUsage): number {
  return (
    u.inputTokens +
    u.cacheReadTokens * CACHE_READ_MULTIPLIER +
    u.cacheCreationTokens * CACHE_WRITE_MULTIPLIER
  );
}

export function cacheHitRate(u: SessionUsage): number {
  const total = u.inputTokens + u.cacheReadTokens + u.cacheCreationTokens;
  if (total === 0) return 0;
  return u.cacheReadTokens / total;
}

export interface SessionRequest {
  personaId: string;
  // Non-cached, per-call suffix.
  personaSystemSuffix: string;
  sampling: { temperature: number; maxTokens: number; topP?: number };
  model?: string;
  // Placed last in the rendered prompt so the cached prefix stays
  // intact across calls.
  userMessage: string;
}

export interface SessionResponse {
  text: string;
  usage: SessionUsage;
  model: string;
  stopReason: string | null;
}

export type StreamDecision = { kind: 'continue' } | { kind: 'abort'; reason: string };

export interface SessionStreamEvent {
  partialText: string;
  chunk: string;
  charsObserved: number;
}

export type SessionStreamObserver = (event: SessionStreamEvent) => StreamDecision;

export interface SessionStreamResult {
  // When `aborted` is true, `text` is the partial text observed up to
  // abort and `usage` reflects tokens billed up to that point.
  response: SessionResponse;
  aborted: boolean;
  abortReason: string | null;
}

// "stub" is the heuristic back-compat alias for legacy callers.
export interface ProviderInfo {
  provider: 'deterministic' | 'local' | 'anthropic' | 'stub';
  model: string | null;
  backend: string | null;
  grammar: string | null;
  seed: number | null;
  usageEstimated: boolean;
}

// Three implementations: DeterministicSession (no model; emits
// externally-sourced patches from a directory, queue file, or stdin),
// LocalSession (OpenAI-compat / Ollama / llama.cpp / vLLM), and
// AnthropicSession (real API, prompt-cache-native). Callers treat all
// three identically.
export interface Session {
  complete(request: SessionRequest): Promise<SessionResponse>;
  totalUsage(): SessionUsage;
  providerInfo(): ProviderInfo;
  projectContext(): string;
  // Implementations that don't natively stream may simulate it by
  // chunking a non-streaming response.
  stream(
    request: SessionRequest,
    observer: SessionStreamObserver,
  ): Promise<SessionStreamResult>;
}
