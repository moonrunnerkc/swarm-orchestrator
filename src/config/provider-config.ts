import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { LOCAL_BACKEND_NAMES, type LocalBackendName } from '../inference/local/factory';
import {
  EXTRACTOR_PROVIDERS,
  type ExtractorProvider,
} from '../contract/extractor/factory';
import {
  SESSION_PROVIDERS,
  type SessionProvider,
} from '../session/factory';
import {
  LOCAL_GRAMMAR_MODES,
  type LocalGrammarMode,
} from '../cli/v8/local-provider-flags';

/**
 * Loader for the `provider:` block in `.swarm/config.yaml`. The block
 * sits below CLI flags and env vars in the precedence chain:
 *
 *   flag > env var > config file > built-in default
 *
 * A missing config file is not an error; an absent `provider:` block is
 * not an error; an unknown field inside the block IS an error so the
 * loader fails loud per the prompt.
 */

/** Resolved `provider.local` sub-block. */
export interface ResolvedLocalProviderConfig {
  backend: LocalBackendName | null;
  baseUrl: string | null;
  modelExtractor: string | null;
  modelSession: string | null;
  personaModelMap: Readonly<Record<string, string>> | null;
  grammar: LocalGrammarMode | null;
  requestTimeoutMs: number | null;
  maxConcurrency: number | null;
  seed: number | null;
}

/** Resolved `provider:` block. */
export interface ResolvedProviderConfig {
  extractor: ExtractorProvider | null;
  session: SessionProvider | null;
  local: ResolvedLocalProviderConfig;
}

/** All-null defaults so callers can spread without conditional checks. */
export function emptyProviderConfig(): ResolvedProviderConfig {
  return {
    extractor: null,
    session: null,
    local: {
      backend: null,
      baseUrl: null,
      modelExtractor: null,
      modelSession: null,
      personaModelMap: null,
      grammar: null,
      requestTimeoutMs: null,
      maxConcurrency: null,
      seed: null,
    },
  };
}

/**
 * Read `.swarm/config.yaml` from the supplied project root and return the
 * `provider:` block. Returns an all-null config when:
 *   - The file does not exist.
 *   - The file exists but has no `provider:` block.
 *
 * @throws when the file is unreadable, when YAML parsing fails, or when
 *         the block contains an unknown key, a wrongly-typed value, or
 *         an enum value outside the allowed set. Error messages name the
 *         offending key path so users can locate the problem.
 */
export function loadProviderConfig(projectRoot: string): ResolvedProviderConfig {
  const configPath = path.join(projectRoot, '.swarm', 'config.yaml');
  if (!fs.existsSync(configPath)) return emptyProviderConfig();

  let body: string;
  try {
    body = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    throw new Error(
      `cannot read .swarm/config.yaml at ${configPath}: ${(err as Error).message}`,
      { cause: err },
    );
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(body);
  } catch (err) {
    throw new Error(
      `.swarm/config.yaml is not valid YAML: ${(err as Error).message}`,
      { cause: err },
    );
  }

  if (parsed === null || parsed === undefined) return emptyProviderConfig();
  if (!isRecord(parsed)) {
    throw new Error('.swarm/config.yaml must be a mapping at the top level');
  }
  const providerBlock = parsed['provider'];
  if (providerBlock === undefined) return emptyProviderConfig();
  if (!isRecord(providerBlock)) {
    throw new Error('.swarm/config.yaml: `provider` must be a mapping');
  }
  return parseProviderBlock(providerBlock);
}

const ALLOWED_PROVIDER_KEYS = new Set(['extractor', 'session', 'local']);
const ALLOWED_LOCAL_KEYS = new Set([
  'backend',
  'base_url',
  'model_extractor',
  'model_session',
  'persona_model_map',
  'grammar',
  'request_timeout_ms',
  'max_concurrency',
  'seed',
]);

function parseProviderBlock(block: Record<string, unknown>): ResolvedProviderConfig {
  const out = emptyProviderConfig();
  for (const key of Object.keys(block)) {
    if (!ALLOWED_PROVIDER_KEYS.has(key)) {
      throw new Error(
        `.swarm/config.yaml: unknown key "provider.${key}"; allowed: ${[
          ...ALLOWED_PROVIDER_KEYS,
        ].join(', ')}`,
      );
    }
  }

  if (block['extractor'] !== undefined) {
    const raw = block['extractor'];
    if (typeof raw !== 'string') {
      throw new Error('.swarm/config.yaml: `provider.extractor` must be a string');
    }
    if (!(EXTRACTOR_PROVIDERS as readonly string[]).includes(raw)) {
      throw new Error(
        `.swarm/config.yaml: \`provider.extractor\` "${raw}" is not one of: ${EXTRACTOR_PROVIDERS.join(
          ', ',
        )}`,
      );
    }
    out.extractor = raw as ExtractorProvider;
  }

  if (block['session'] !== undefined) {
    const raw = block['session'];
    if (typeof raw !== 'string') {
      throw new Error('.swarm/config.yaml: `provider.session` must be a string');
    }
    if (!(SESSION_PROVIDERS as readonly string[]).includes(raw)) {
      throw new Error(
        `.swarm/config.yaml: \`provider.session\` "${raw}" is not one of: ${SESSION_PROVIDERS.join(
          ', ',
        )}`,
      );
    }
    out.session = raw as SessionProvider;
  }

  if (block['local'] !== undefined) {
    if (!isRecord(block['local'])) {
      throw new Error('.swarm/config.yaml: `provider.local` must be a mapping');
    }
    out.local = parseLocalBlock(block['local']);
  }

  return out;
}

function parseLocalBlock(block: Record<string, unknown>): ResolvedLocalProviderConfig {
  const out = emptyProviderConfig().local;
  for (const key of Object.keys(block)) {
    if (!ALLOWED_LOCAL_KEYS.has(key)) {
      throw new Error(
        `.swarm/config.yaml: unknown key "provider.local.${key}"; allowed: ${[
          ...ALLOWED_LOCAL_KEYS,
        ].join(', ')}`,
      );
    }
  }

  if (block['backend'] !== undefined) {
    const raw = block['backend'];
    if (typeof raw !== 'string' || !LOCAL_BACKEND_NAMES.includes(raw as LocalBackendName)) {
      throw new Error(
        `.swarm/config.yaml: \`provider.local.backend\` must be one of: ${LOCAL_BACKEND_NAMES.join(
          ', ',
        )}`,
      );
    }
    out.backend = raw as LocalBackendName;
  }
  if (block['base_url'] !== undefined) {
    const raw = block['base_url'];
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new Error('.swarm/config.yaml: `provider.local.base_url` must be a non-empty string');
    }
    out.baseUrl = raw;
  }
  if (block['model_extractor'] !== undefined) {
    const raw = block['model_extractor'];
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new Error(
        '.swarm/config.yaml: `provider.local.model_extractor` must be a non-empty string',
      );
    }
    out.modelExtractor = raw;
  }
  if (block['model_session'] !== undefined) {
    const raw = block['model_session'];
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new Error(
        '.swarm/config.yaml: `provider.local.model_session` must be a non-empty string',
      );
    }
    out.modelSession = raw;
  }
  if (block['persona_model_map'] !== undefined) {
    const raw = block['persona_model_map'];
    if (!isRecord(raw)) {
      throw new Error(
        '.swarm/config.yaml: `provider.local.persona_model_map` must be a mapping of persona ids to model ids',
      );
    }
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v !== 'string') {
        throw new Error(
          `.swarm/config.yaml: \`provider.local.persona_model_map.${k}\` must be a string`,
        );
      }
      map[k] = v;
    }
    out.personaModelMap = Object.freeze(map);
  }
  if (block['grammar'] !== undefined) {
    const raw = block['grammar'];
    if (typeof raw !== 'string' || !LOCAL_GRAMMAR_MODES.includes(raw as LocalGrammarMode)) {
      throw new Error(
        `.swarm/config.yaml: \`provider.local.grammar\` must be one of: ${LOCAL_GRAMMAR_MODES.join(
          ', ',
        )}`,
      );
    }
    out.grammar = raw as LocalGrammarMode;
  }
  if (block['request_timeout_ms'] !== undefined) {
    const raw = block['request_timeout_ms'];
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
      throw new Error(
        '.swarm/config.yaml: `provider.local.request_timeout_ms` must be a positive number',
      );
    }
    out.requestTimeoutMs = raw;
  }
  if (block['max_concurrency'] !== undefined) {
    const raw = block['max_concurrency'];
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
      throw new Error(
        '.swarm/config.yaml: `provider.local.max_concurrency` must be a positive number',
      );
    }
    out.maxConcurrency = raw;
  }
  if (block['seed'] !== undefined) {
    const raw = block['seed'];
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
      throw new Error(
        '.swarm/config.yaml: `provider.local.seed` must be a non-negative number',
      );
    }
    out.seed = raw;
  }

  return out;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}
