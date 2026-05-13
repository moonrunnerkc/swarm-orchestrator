import * as fs from 'fs';
import * as path from 'path';
import {
  addUsage,
  emptyUsage,
  type ProviderInfo,
  type Session,
  type SessionRequest,
  type SessionResponse,
  type SessionStreamEvent,
  type SessionStreamObserver,
  type SessionStreamResult,
  type SessionUsage,
} from './types';
import {
  type BackendUsage,
  type ChatMessage,
  type GrammarSpec,
  type LocalBackend,
} from '../inference/local/backend';
import { getLogger } from '../logger';

const logger = getLogger('session:local');

/** Construction options for {@link LocalSession}. */
export interface LocalSessionOptions {
  /** Static project-context prefix sent on every call. */
  projectContext: string;
  /** Backend the session talks to. */
  backend: LocalBackend;
  /** Default model id. */
  model: string;
  /** Optional per-persona model overrides. */
  personaModelMap?: Readonly<Record<string, string>>;
  /** Grammar mode: `auto` (default), `gbnf`, `json-schema`, `outlines`, or `none`. */
  grammar?: 'auto' | 'gbnf' | 'json-schema' | 'outlines' | 'none';
  /** Sampling seed; default 0 for reproducibility. */
  seed?: number;
}

/**
 * Session backed by a local inference endpoint. Each `complete()` call
 * issues one chat completion against the backend with the unified-diff
 * grammar requested when the backend supports it. Token usage is taken
 * from the backend's reported counts; when the backend doesn't report
 * (Ollama, llama.cpp without `--verbose`), `usageEstimated: true` is
 * recorded on the provider info so the ledger can flag the entry.
 *
 * Persona routing: when `personaModelMap` is set, a request's persona id
 * selects the model id over the session's default. The map is open-ended;
 * keys not present fall back to the default.
 */
export class LocalSession implements Session {
  private readonly contextText: string;
  private readonly backend: LocalBackend;
  private readonly defaultModel: string;
  private readonly personaModelMap: Readonly<Record<string, string>>;
  private readonly requestedGrammar: 'auto' | 'gbnf' | 'json-schema' | 'outlines' | 'none';
  private readonly seed: number;
  private cumulative: SessionUsage = emptyUsage();
  private anyEstimated = false;

  constructor(options: LocalSessionOptions) {
    this.contextText = options.projectContext;
    this.backend = options.backend;
    this.defaultModel = options.model;
    this.personaModelMap = options.personaModelMap ?? {};
    this.requestedGrammar = options.grammar ?? 'auto';
    this.seed = options.seed ?? 0;
  }

  projectContext(): string {
    return this.contextText;
  }

  totalUsage(): SessionUsage {
    return { ...this.cumulative };
  }

  providerInfo(): ProviderInfo {
    return {
      provider: 'local',
      model: this.defaultModel,
      backend: this.backend.name,
      grammar: this.resolvedGrammarKind(),
      seed: this.seed,
      usageEstimated: this.anyEstimated,
    };
  }

  async complete(request: SessionRequest): Promise<SessionResponse> {
    const model = this.resolveModel(request);
    const grammar = this.selectGrammar();
    const messages = this.renderMessages(request);
    const response = await this.backend.chat({
      model,
      messages,
      temperature: request.sampling.temperature,
      maxTokens: request.sampling.maxTokens,
      seed: this.seed,
      grammar,
    });
    const usage = toSessionUsage(response.usage);
    this.cumulative = addUsage(this.cumulative, usage);
    if (response.usageEstimated) this.anyEstimated = true;
    return {
      text: response.text,
      usage,
      model,
      stopReason: 'end_turn',
    };
  }

  async stream(
    request: SessionRequest,
    observer: SessionStreamObserver,
  ): Promise<SessionStreamResult> {
    const model = this.resolveModel(request);
    const grammar = this.selectGrammar();
    const messages = this.renderMessages(request);
    let observerAbortReason: string | null = null;
    const result = await this.backend.stream(
      {
        model,
        messages,
        temperature: request.sampling.temperature,
        maxTokens: request.sampling.maxTokens,
        seed: this.seed,
        grammar,
      },
      (event) => {
        const decision = observer(toSessionStreamEvent(event));
        if (decision.kind === 'abort') {
          observerAbortReason = decision.reason;
          return false;
        }
        return true;
      },
    );
    const usage = toSessionUsage(result.usage);
    this.cumulative = addUsage(this.cumulative, usage);
    if (result.usageEstimated) this.anyEstimated = true;
    const aborted = result.aborted;
    return {
      response: {
        text: result.text,
        usage,
        model,
        stopReason: aborted ? 'observer_abort' : 'end_turn',
      },
      aborted,
      abortReason: aborted ? observerAbortReason ?? 'observer aborted' : null,
    };
  }

  private resolveModel(request: SessionRequest): string {
    if (request.model) return request.model;
    return this.personaModelMap[request.personaId] ?? this.defaultModel;
  }

  private renderMessages(request: SessionRequest): ChatMessage[] {
    const systemContent =
      request.personaSystemSuffix.length > 0
        ? `${this.contextText}\n\n---\n${request.personaSystemSuffix}`
        : this.contextText;
    return [
      { role: 'system', content: systemContent },
      { role: 'user', content: request.userMessage },
    ];
  }

  private resolvedGrammarKind(): string | null {
    const supported = this.backend.supportsGrammar();
    if (this.requestedGrammar === 'none') return 'none';
    if (this.requestedGrammar === 'gbnf' && supported.includes('gbnf')) return 'gbnf';
    if (this.requestedGrammar === 'json-schema' && supported.includes('json-schema')) {
      return 'json-schema';
    }
    if (this.requestedGrammar === 'auto') {
      if (supported.includes('gbnf')) return 'gbnf';
      if (supported.includes('json-schema')) return 'json-schema';
      return 'none';
    }
    logger.warn(
      `local session: requested grammar "${this.requestedGrammar}" but backend ` +
        `"${this.backend.name}" advertises [${supported.join(', ')}]; falling back to none`,
    );
    return 'none';
  }

  private selectGrammar(): GrammarSpec {
    const kind = this.resolvedGrammarKind();
    if (kind === 'gbnf') return { kind: 'gbnf', grammar: loadUnifiedDiffGrammar() };
    // JSON Schema grammar for the session is intentionally unset: the
    // session's job is to emit FORMAT 1/2/3 patches, not structured JSON.
    return { kind: 'none' };
  }
}

function toSessionUsage(u: BackendUsage): SessionUsage {
  return {
    inputTokens: u.inputTokens,
    cacheReadTokens: u.cacheReadTokens,
    cacheCreationTokens: u.cacheCreationTokens,
    outputTokens: u.outputTokens,
  };
}

function toSessionStreamEvent(event: { chunk: string; partialText: string }): SessionStreamEvent {
  return {
    chunk: event.chunk,
    partialText: event.partialText,
    charsObserved: event.partialText.length,
  };
}

let cachedGrammar: string | undefined;

function loadUnifiedDiffGrammar(): string {
  if (cachedGrammar !== undefined) return cachedGrammar;
  const candidates = [
    path.join(__dirname, '..', 'inference', 'local', 'grammars', 'unified-diff.gbnf'),
    path.join(__dirname, '..', '..', 'src', 'inference', 'local', 'grammars', 'unified-diff.gbnf'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      cachedGrammar = fs.readFileSync(candidate, 'utf8');
      return cachedGrammar;
    }
  }
  throw new Error(
    'local session: unified-diff.gbnf not found; expected next to the compiled local-session module. ' +
      'Re-run `npm run build` to copy grammar files into dist/.',
  );
}
