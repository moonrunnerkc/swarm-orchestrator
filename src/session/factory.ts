import { AnthropicSession } from './anthropic-session';
import {
  DeterministicSession,
  type ExternalPatchEnvelope,
  type PatchSource,
} from './deterministic-session';
import { LocalSession } from './local-session';
import { type Session } from './types';
import {
  buildLocalBackend,
  resolveLocalBackendName,
  resolveLocalBaseUrl,
  type LocalBackendName,
} from '../inference/local/factory';

/**
 * Provider identifier for the session factory. The CLI exposes exactly
 * three providers: `deterministic`, `local`, and `anthropic`.
 * `StubSession` exists for internal tests and the synthetic-mode
 * benchmark; it is not reachable from any CLI flag, env var, or config
 * file. Tests construct it directly via `new StubSession({...})`.
 */
export type SessionProvider = 'deterministic' | 'local' | 'anthropic';

/** Validated provider names accepted by the factory. */
export const SESSION_PROVIDERS: readonly SessionProvider[] = [
  'deterministic',
  'local',
  'anthropic',
] as const;

/** Flags consumed by {@link buildSession}. */
export interface SessionFactoryFlags {
  provider: SessionProvider;
  projectContext: string;
  apiKey?: string | null;
  model?: string | null;
  /** Directory channel for deterministic patches. */
  externalPatchesDir?: string | null;
  /** JSONL queue file for deterministic patches. */
  externalPatchesQueue?: string | null;
  /** When true, the deterministic session reads patches from stdin. */
  externalPatchesStdin?: boolean;
  /** Pre-loaded envelopes (stdin caller pre-reads, or tests inject). */
  preloadedPatches?: readonly ExternalPatchEnvelope[];
  /** Per-call timeout for the deterministic session. */
  externalPatchesTimeoutMs?: number | null;
  /** Local backend selector. */
  localBackend?: LocalBackendName | null;
  /** Local backend base URL. */
  localBaseUrl?: string | null;
  /** Default model id for the local session. */
  localModel?: string | null;
  /** Persona id → model id map for the local session. */
  localPersonaModelMap?: Readonly<Record<string, string>>;
  /** Grammar mode for the local session. */
  localGrammar?: 'auto' | 'gbnf' | 'json-schema' | 'outlines' | 'none' | null;
  /** Sampling seed. */
  localSeed?: number | null;
  /** Local backend API key. */
  localApiKey?: string | null;
}

/**
 * Resolve provider selection and construct the matching session. Each
 * branch reads its own configuration; misconfiguration is fail-loud with a
 * corrective hint.
 *
 * @throws when the deterministic provider has no patch source, when the
 *         Anthropic provider has no API key, or when an unsupported
 *         provider name is supplied.
 */
export function buildSession(flags: SessionFactoryFlags): Session {
  if (flags.provider === 'deterministic') {
    return buildDeterministicSession(flags);
  }
  if (flags.provider === 'local') {
    return buildLocalSession(flags);
  }
  if (flags.provider === 'anthropic') {
    return buildAnthropicSession(flags);
  }
  throw new Error(
    `unknown session provider "${flags.provider as string}"; ` +
      `expected one of: ${SESSION_PROVIDERS.join(', ')}`,
  );
}

function buildDeterministicSession(flags: SessionFactoryFlags): Session {
  const source = resolveSource(flags);
  const opts: ConstructorParameters<typeof DeterministicSession>[0] = {
    projectContext: flags.projectContext,
    source,
  };
  if (flags.preloadedPatches !== undefined) opts.preloaded = flags.preloadedPatches;
  if (flags.externalPatchesTimeoutMs !== null && flags.externalPatchesTimeoutMs !== undefined) {
    opts.externalPatchesTimeoutMs = flags.externalPatchesTimeoutMs;
  }
  return new DeterministicSession(opts);
}

function resolveSource(flags: SessionFactoryFlags): PatchSource {
  if (flags.externalPatchesDir) return { kind: 'dir', path: flags.externalPatchesDir };
  if (flags.externalPatchesQueue) return { kind: 'queue', path: flags.externalPatchesQueue };
  if (flags.externalPatchesStdin || flags.preloadedPatches !== undefined) {
    return { kind: 'stdin' };
  }
  throw new Error(
    'deterministic session selected but no patch source provided; ' +
      'pass --external-patches-dir <path>, --external-patches-queue <path>, or ' +
      '--external-patches-stdin (set EXTERNAL_PATCHES_DIR / EXTERNAL_PATCHES_QUEUE to ' +
      'configure via the environment)',
  );
}

function buildLocalSession(flags: SessionFactoryFlags): Session {
  const backendName = resolveLocalBackendName(flags.localBackend ?? null);
  const baseUrl = resolveLocalBaseUrl(flags.localBaseUrl ?? null);
  const model = flags.localModel ?? process.env.LOCAL_LLM_MODEL_SESSION ?? null;
  if (!model) {
    throw new Error(
      'local session selected but no model id provided; ' +
        'set LOCAL_LLM_MODEL_SESSION or pass --local-model-session',
    );
  }
  const backend = buildLocalBackend({
    backend: backendName,
    baseUrl,
    apiKey: flags.localApiKey ?? process.env.LOCAL_LLM_API_KEY ?? null,
  });
  const opts: ConstructorParameters<typeof LocalSession>[0] = {
    projectContext: flags.projectContext,
    backend,
    model,
  };
  if (flags.localPersonaModelMap) opts.personaModelMap = flags.localPersonaModelMap;
  if (flags.localGrammar) opts.grammar = flags.localGrammar;
  if (flags.localSeed !== null && flags.localSeed !== undefined) opts.seed = flags.localSeed;
  return new LocalSession(opts);
}

function buildAnthropicSession(flags: SessionFactoryFlags): Session {
  const apiKey = flags.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'anthropic session selected but ANTHROPIC_API_KEY is not set; ' +
        'pass --api-key, set the env var, or switch to --session deterministic',
    );
  }
  const opts: ConstructorParameters<typeof AnthropicSession>[0] = {
    apiKey,
    projectContext: flags.projectContext,
  };
  if (flags.model !== null && flags.model !== undefined) opts.model = flags.model;
  return new AnthropicSession(opts);
}

/**
 * Resolve the session provider name from the CLI flag, the
 * `SESSION_PROVIDER` env var, and the default (`deterministic`). Returns
 * the resolved name; the caller validates membership in
 * {@link SESSION_PROVIDERS}.
 */
export function resolveSessionProvider(flagValue: string | null): SessionProvider {
  const raw = flagValue ?? process.env.SESSION_PROVIDER ?? 'deterministic';
  if (!SESSION_PROVIDERS.includes(raw as SessionProvider)) {
    throw new Error(
      `invalid session provider "${raw}"; expected one of: ${SESSION_PROVIDERS.join(', ')}`,
    );
  }
  return raw as SessionProvider;
}
