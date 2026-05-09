import {
  addUsage,
  emptyUsage,
  type Session,
  type SessionRequest,
  type SessionResponse,
  type SessionStreamObserver,
  type SessionStreamResult,
  type SessionUsage,
} from './types';

/**
 * Generator function: given the persona id and the dynamic user message,
 * return the assistant text the stub session should respond with. The
 * function is invoked synchronously inside `complete()` so test code can
 * assert on the exact response shape.
 */
export type StubResponder = (request: SessionRequest, callIndex: number) => string;

export interface StubSessionOptions {
  /** Static project-context prefix; reported by `projectContext()`. */
  projectContext: string;
  /** Default model id reported on responses. */
  model?: string;
  /**
   * The stub's response generator. If omitted, the session echoes the
   * persona id and a fingerprint of the dynamic message — useful for tests
   * that assert calls happened, not specific text.
   */
  responder?: StubResponder;
  /**
   * Phase 6: chunk size used by the simulated streaming path. The stub
   * splits the responder's output into chunks of this size and feeds the
   * observer one chunk at a time. Defaults to 32 chars; tests may shrink
   * to 1 to exercise per-character abort timing.
   */
  streamChunkSize?: number;
}

/**
 * Deterministic in-memory session. Reports synthetic but consistent token
 * usage so the run-time pipeline can be exercised end-to-end without real
 * API access. Cache modeling: the static project context counts as a cache
 * write on the first call and a cache read on every subsequent call —
 * matching how Anthropic's prompt cache actually behaves on a hot prefix.
 *
 * Token estimates use the conventional "4 chars per token" heuristic. This
 * is approximate but sufficient for unit tests; the synthetic-mode
 * benchmark applies the same heuristic on both the v6 and v8 sides so the
 * comparison is fair.
 */
export class StubSession implements Session {
  private cumulative: SessionUsage = emptyUsage();
  private callCount = 0;
  private readonly contextText: string;
  private readonly modelId: string;
  private readonly responder: StubResponder;
  private readonly streamChunkSize: number;

  constructor(options: StubSessionOptions) {
    this.contextText = options.projectContext;
    this.modelId = options.model ?? 'stub-model';
    this.responder = options.responder ?? defaultResponder;
    this.streamChunkSize = options.streamChunkSize ?? 32;
  }

  projectContext(): string {
    return this.contextText;
  }

  totalUsage(): SessionUsage {
    return { ...this.cumulative };
  }

  async complete(request: SessionRequest): Promise<SessionResponse> {
    const callIndex = this.callCount;
    this.callCount += 1;
    const text = this.responder(request, callIndex);

    const contextTokens = estimateTokens(this.contextText);
    const personaTokens = estimateTokens(request.personaSystemSuffix);
    const dynamicTokens = estimateTokens(request.userMessage);
    const outputTokens = estimateTokens(text);

    // Persona suffix is non-cached; project context is cached after the
    // first call. The non-cache portion always includes persona + dynamic.
    const nonCacheInput = personaTokens + dynamicTokens;
    const usage: SessionUsage =
      callIndex === 0
        ? {
            inputTokens: nonCacheInput,
            cacheReadTokens: 0,
            cacheCreationTokens: contextTokens,
            outputTokens,
          }
        : {
            inputTokens: nonCacheInput,
            cacheReadTokens: contextTokens,
            cacheCreationTokens: 0,
            outputTokens,
          };

    this.cumulative = addUsage(this.cumulative, usage);

    return {
      text,
      usage,
      model: this.modelId,
      stopReason: 'end_turn',
    };
  }

  /**
   * Phase 6: simulated streaming. The stub computes the full responder
   * output up front and slices it into `streamChunkSize`-character
   * chunks, feeding the observer one chunk at a time. When the observer
   * returns `abort`, only the partial text observed up to that chunk
   * counts toward output usage; cache reads/writes for the prefix are
   * billed identically to `complete()`.
   */
  async stream(
    request: SessionRequest,
    observer: SessionStreamObserver,
  ): Promise<SessionStreamResult> {
    const callIndex = this.callCount;
    this.callCount += 1;
    const fullText = this.responder(request, callIndex);

    const contextTokens = estimateTokens(this.contextText);
    const personaTokens = estimateTokens(request.personaSystemSuffix);
    const dynamicTokens = estimateTokens(request.userMessage);
    const nonCacheInput = personaTokens + dynamicTokens;

    let partialText = '';
    let aborted = false;
    let abortReason: string | null = null;
    const chunkSize = Math.max(1, this.streamChunkSize);
    for (let i = 0; i < fullText.length; i += chunkSize) {
      const chunk = fullText.slice(i, i + chunkSize);
      partialText += chunk;
      const decision = observer({
        partialText,
        chunk,
        charsObserved: partialText.length,
      });
      if (decision.kind === 'abort') {
        aborted = true;
        abortReason = decision.reason;
        break;
      }
    }

    const finalText = aborted ? partialText : fullText;
    const outputTokens = estimateTokens(finalText);
    const usage: SessionUsage =
      callIndex === 0
        ? {
            inputTokens: nonCacheInput,
            cacheReadTokens: 0,
            cacheCreationTokens: contextTokens,
            outputTokens,
          }
        : {
            inputTokens: nonCacheInput,
            cacheReadTokens: contextTokens,
            cacheCreationTokens: 0,
            outputTokens,
          };
    this.cumulative = addUsage(this.cumulative, usage);

    return {
      response: {
        text: finalText,
        usage,
        model: this.modelId,
        stopReason: aborted ? 'observer_abort' : 'end_turn',
      },
      aborted,
      abortReason,
    };
  }
}

/**
 * Anthropic's published rule of thumb: ~4 characters per token for English
 * source text. Off by 10–20% on real prose; tight enough for the synthetic
 * benchmark where v6 and v8 are tokenized the same way and the cost ratio
 * is what matters.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function defaultResponder(request: SessionRequest, callIndex: number): string {
  return [
    `stub-response: persona=${request.personaId} call=${callIndex}`,
    `length=${request.userMessage.length}`,
  ].join(' ');
}
