import { AnthropicExtractor } from './anthropic-extractor';
import { DeterministicExtractor } from './deterministic-extractor';
import { type ContractEnvelope } from './contract-schema';
import { LocalExtractor } from './local-extractor';
import { type Extractor } from './types';
import {
  buildLocalBackend,
  resolveLocalBackendName,
  resolveLocalBaseUrl,
  type LocalBackendName,
} from '../../inference/local/factory';

/**
 * Provider identifier for the extractor factory. The CLI exposes exactly
 * three providers: `deterministic`, `local`, and `anthropic`. The
 * heuristic `StubExtractor` still ships as a library export for tests
 * and the synthetic benchmark, but the factory deliberately does not
 * accept a `stub` provider name.
 */
export type ExtractorProvider = 'deterministic' | 'local' | 'anthropic';

/** Validated provider names accepted by the factory. */
export const EXTRACTOR_PROVIDERS: readonly ExtractorProvider[] = [
  'deterministic',
  'local',
  'anthropic',
] as const;

/** Flags consumed by {@link buildExtractor}. */
export interface ExtractorFactoryFlags {
  provider: ExtractorProvider;
  /** Path to a YAML or JSON contract file. Used when provider=deterministic. */
  contractFile?: string | null;
  /** Path to a TS/JS contract module. Used when provider=deterministic. */
  contractModule?: string | null;
  /** Inline contract envelope (e.g. from .swarm/config.yaml). */
  inlineContract?: ContractEnvelope | null;
  /** Anthropic API key override. */
  apiKey?: string | null;
  /** Model id override. Anthropic + local. */
  model?: string | null;
  /** Sampling temperature override. Anthropic + local. */
  temperature?: number | null;
  /** Local backend selector. Falls back to LOCAL_LLM_BACKEND env var. */
  localBackend?: LocalBackendName | null;
  /** Local backend base URL. Falls back to LOCAL_LLM_BASE_URL env var. */
  localBaseUrl?: string | null;
  /** Local model id. Falls back to LOCAL_LLM_MODEL_EXTRACTOR env var. */
  localModel?: string | null;
  /** Grammar mode for the local extractor. */
  localGrammar?: 'auto' | 'json-schema' | 'none' | null;
  /** Sampling seed for the local extractor. */
  localSeed?: number | null;
  /** Local backend API key. */
  localApiKey?: string | null;
  /** Per-request timeout in ms for the local backend (default 120000). */
  localRequestTimeoutMs?: number | null;
  /** Max in-flight concurrent local-backend requests (default 1). */
  localMaxConcurrency?: number | null;
}

/**
 * Resolve provider selection and construct the matching extractor. Each
 * branch reads its own configuration; misconfiguration is fail-loud with a
 * corrective hint.
 *
 * @throws when the deterministic provider is selected without any contract
 *         input form, or the Anthropic provider is selected without an API
 *         key, or an unsupported provider value is passed.
 */
export function buildExtractor(flags: ExtractorFactoryFlags): Extractor {
  if (flags.provider === 'deterministic') {
    return buildDeterministicExtractor(flags);
  }
  if (flags.provider === 'local') {
    return buildLocalExtractor(flags);
  }
  if (flags.provider === 'anthropic') {
    return buildAnthropicExtractor(flags);
  }
  throw new Error(
    `unknown extractor provider "${flags.provider as string}"; ` +
      `expected one of: ${EXTRACTOR_PROVIDERS.join(', ')}`,
  );
}

function buildDeterministicExtractor(flags: ExtractorFactoryFlags): Extractor {
  if (flags.contractFile) return DeterministicExtractor.fromFile(flags.contractFile);
  if (flags.contractModule) return DeterministicExtractor.fromModule(flags.contractModule);
  if (flags.inlineContract) return DeterministicExtractor.fromInline(flags.inlineContract);
  throw new Error(
    'deterministic extractor selected but no contract input provided; ' +
      'pass --contract-file <path>, --contract-module <path>, or set provider.extractor with ' +
      'a contract: block in .swarm/config.yaml',
  );
}

function buildLocalExtractor(flags: ExtractorFactoryFlags): Extractor {
  const backendName = resolveLocalBackendName(flags.localBackend ?? null);
  const baseUrl = resolveLocalBaseUrl(flags.localBaseUrl ?? null);
  const model =
    flags.localModel ?? process.env.LOCAL_LLM_MODEL_EXTRACTOR ?? null;
  if (!model) {
    throw new Error(
      'local extractor selected but no model id provided; ' +
        'set LOCAL_LLM_MODEL_EXTRACTOR or pass --local-model-extractor',
    );
  }
  const backendOpts: Parameters<typeof buildLocalBackend>[0] = {
    backend: backendName,
    baseUrl,
    apiKey: flags.localApiKey ?? process.env.LOCAL_LLM_API_KEY ?? null,
  };
  if (flags.localRequestTimeoutMs !== null && flags.localRequestTimeoutMs !== undefined) {
    backendOpts.requestTimeoutMs = flags.localRequestTimeoutMs;
  }
  if (flags.localMaxConcurrency !== null && flags.localMaxConcurrency !== undefined) {
    backendOpts.maxConcurrency = flags.localMaxConcurrency;
  }
  const backend = buildLocalBackend(backendOpts);
  const opts: ConstructorParameters<typeof LocalExtractor>[0] = { backend, model };
  if (flags.localGrammar) opts.grammar = flags.localGrammar;
  if (flags.localSeed !== null && flags.localSeed !== undefined) opts.seed = flags.localSeed;
  if (flags.temperature !== null && flags.temperature !== undefined) {
    opts.temperature = flags.temperature;
  }
  return new LocalExtractor(opts);
}

function buildAnthropicExtractor(flags: ExtractorFactoryFlags): Extractor {
  const apiKey = flags.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'anthropic extractor selected but ANTHROPIC_API_KEY is not set; ' +
        'pass --api-key, set the env var, or switch to --extractor deterministic',
    );
  }
  const opts: ConstructorParameters<typeof AnthropicExtractor>[0] = { apiKey };
  if (flags.model !== null && flags.model !== undefined) opts.model = flags.model;
  if (flags.temperature !== null && flags.temperature !== undefined) {
    opts.temperature = flags.temperature;
  }
  return new AnthropicExtractor(opts);
}

/**
 * Resolve the extractor provider name from the CLI flag (when set), the
 * `EXTRACTOR_PROVIDER` env var (when set), and the default (`deterministic`).
 * Returns the resolved name; the caller validates membership in
 * {@link EXTRACTOR_PROVIDERS}.
 */
export function resolveExtractorProvider(flagValue: string | null): ExtractorProvider {
  const raw = flagValue ?? process.env.EXTRACTOR_PROVIDER ?? 'deterministic';
  if (!EXTRACTOR_PROVIDERS.includes(raw as ExtractorProvider)) {
    throw new Error(
      `invalid extractor provider "${raw}"; expected one of: ${EXTRACTOR_PROVIDERS.join(', ')}`,
    );
  }
  return raw as ExtractorProvider;
}
