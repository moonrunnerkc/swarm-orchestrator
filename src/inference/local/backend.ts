/**
 * Backend abstraction for the local-inference provider. Four backends ship
 * in tree: openai-compatible, ollama, llama-cpp, vllm. Adding a fifth backend
 * is one new file under `backends/` that exports a {@link LocalBackend} value
 * keyed in the factory.
 *
 * The interface is intentionally small. Each backend implements four
 * methods: a non-streaming chat completion, a streaming variant, a grammar
 * capability report, and a usage-reporting hint. The local extractor and
 * local session compose against this interface — they do not import any
 * specific backend module.
 */

/** Message roles in the chat protocol shared by every backend. */
export type ChatRole = 'system' | 'user' | 'assistant';

/** Single chat message. */
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** Grammar specification handed to a backend on a request. */
export type GrammarSpec =
  | { kind: 'none' }
  | { kind: 'json-schema'; schema: unknown }
  | { kind: 'gbnf'; grammar: string };

/** Per-request configuration. */
export interface BackendRequest {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
  /** Sampling seed. Backends that don't honor seeds ignore this. */
  seed?: number | null;
  /** Stop sequences. Backends that don't honor them ignore this. */
  stop?: readonly string[];
  /** Grammar-constrained decoding request. */
  grammar?: GrammarSpec;
  /** Backend-specific extras the caller can pass through. */
  extras?: Record<string, unknown>;
}

/** Response from a non-streaming chat call. */
export interface BackendResponse {
  text: string;
  /** Backend-reported usage. Fields are zero when the backend doesn't report. */
  usage: BackendUsage;
  /** True when the backend did NOT report token counts (caller must estimate). */
  usageEstimated: boolean;
}

/** Token usage as reported by the backend. */
export interface BackendUsage {
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
}

/** Zero-initialized backend usage record. */
export function emptyBackendUsage(): BackendUsage {
  return {
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
  };
}

/** One observation point during a streaming completion. */
export interface BackendStreamEvent {
  chunk: string;
  partialText: string;
}

/** Observer for streaming events. Return false to abort. */
export type BackendStreamObserver = (event: BackendStreamEvent) => boolean;

/** Final result of a streaming call. */
export interface BackendStreamResult {
  text: string;
  usage: BackendUsage;
  usageEstimated: boolean;
  aborted: boolean;
}

/** Grammar modes a backend may advertise as supported. */
export type SupportedGrammar = 'json-schema' | 'gbnf' | 'outlines' | 'none';

/**
 * The backend interface every local backend implements.
 *
 * @throws when the underlying HTTP call fails. Authentication or connection
 *         errors surface from the backend so the local provider can
 *         construct a corrective message.
 */
export interface LocalBackend {
  /** Stable identifier (matches the LOCAL_LLM_BACKEND env value). */
  readonly name: string;
  /** Run a non-streaming chat completion. */
  chat(request: BackendRequest): Promise<BackendResponse>;
  /** Run a streaming chat completion, feeding chunks to the observer. */
  stream(request: BackendRequest, observer: BackendStreamObserver): Promise<BackendStreamResult>;
  /** Report which grammar modes this backend advertises support for. */
  supportsGrammar(): readonly SupportedGrammar[];
}

/** Construction options shared by every concrete backend. */
export interface BackendOptions {
  baseUrl: string;
  apiKey?: string | null;
  /** Per-request timeout in ms. */
  requestTimeoutMs?: number;
  /** Maximum concurrent in-flight requests. */
  maxConcurrency?: number;
  /** Test seam: replace the HTTP client. */
  fetch?: typeof fetch;
}

/** Default per-request timeout in ms. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

/** Default max concurrency. */
export const DEFAULT_MAX_CONCURRENCY = 1;
