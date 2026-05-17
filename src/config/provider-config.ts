import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { LOCAL_BACKEND_NAMES, type LocalBackendName } from '../inference/local/factory';
import { EXTRACTOR_PROVIDERS, type ExtractorProvider } from '../contract/extractor/factory';
import { SESSION_PROVIDERS, type SessionProvider } from '../session/factory';
import { LOCAL_GRAMMAR_MODES, type LocalGrammarMode } from '../cli/v8/local-provider-types';

/**
 * Loader for the `provider:` block in `.swarm/config.yaml`. The block sits
 * below CLI flags and env vars in the precedence chain:
 *
 *   flag > env var > config file > built-in default
 *
 * A missing config file is not an error; an absent `provider:` block is
 * not an error; an unknown field inside the block IS an error so the
 * loader fails loud.
 */

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

export interface ResolvedProviderConfig {
  extractor: ExtractorProvider | null;
  session: SessionProvider | null;
  local: ResolvedLocalProviderConfig;
}

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
    throw new Error(`.swarm/config.yaml is not valid YAML: ${(err as Error).message}`, {
      cause: err,
    });
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

function cfgError(msg: string): Error {
  return new Error(`.swarm/config.yaml: ${msg}`);
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function asEnum<T extends string>(raw: unknown, where: string, values: readonly T[]): T {
  if (typeof raw !== 'string') throw cfgError(`\`${where}\` must be a string`);
  if (!values.includes(raw as T)) {
    throw cfgError(`\`${where}\` "${raw}" is not one of: ${values.join(', ')}`);
  }
  return raw as T;
}

function asNonEmptyString(raw: unknown, where: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw cfgError(`\`${where}\` must be a non-empty string`);
  }
  return raw;
}

function asPositiveNumber(raw: unknown, where: string): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    throw cfgError(`\`${where}\` must be a positive number`);
  }
  return raw;
}

function asNonNegativeNumber(raw: unknown, where: string): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    throw cfgError(`\`${where}\` must be a non-negative number`);
  }
  return raw;
}

function asStringMap(raw: unknown, where: string): Record<string, string> {
  if (!isRecord(raw)) {
    throw cfgError(`\`${where}\` must be a mapping of persona ids to model ids`);
  }
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'string') throw cfgError(`\`${where}.${k}\` must be a string`);
    map[k] = v;
  }
  return map;
}

type LocalKnob = (out: ResolvedLocalProviderConfig, raw: unknown, where: string) => void;
type ProviderKnob = (out: ResolvedProviderConfig, raw: unknown, where: string) => void;

const LOCAL_KNOBS: Record<string, LocalKnob> = {
  backend: (o, r, w) => {
    o.backend = asEnum(r, w, LOCAL_BACKEND_NAMES);
  },
  base_url: (o, r, w) => {
    o.baseUrl = asNonEmptyString(r, w);
  },
  model_extractor: (o, r, w) => {
    o.modelExtractor = asNonEmptyString(r, w);
  },
  model_session: (o, r, w) => {
    o.modelSession = asNonEmptyString(r, w);
  },
  persona_model_map: (o, r, w) => {
    o.personaModelMap = Object.freeze(asStringMap(r, w));
  },
  grammar: (o, r, w) => {
    o.grammar = asEnum(r, w, LOCAL_GRAMMAR_MODES);
  },
  request_timeout_ms: (o, r, w) => {
    o.requestTimeoutMs = asPositiveNumber(r, w);
  },
  max_concurrency: (o, r, w) => {
    o.maxConcurrency = asPositiveNumber(r, w);
  },
  seed: (o, r, w) => {
    o.seed = asNonNegativeNumber(r, w);
  },
};

const PROVIDER_KNOBS: Record<string, ProviderKnob> = {
  extractor: (o, r, w) => {
    o.extractor = asEnum(r, w, EXTRACTOR_PROVIDERS);
  },
  session: (o, r, w) => {
    o.session = asEnum(r, w, SESSION_PROVIDERS);
  },
  local: (o, r, _w) => {
    if (!isRecord(r)) throw cfgError('`provider.local` must be a mapping');
    o.local = parseLocalBlock(r);
  },
};

function parseProviderBlock(block: Record<string, unknown>): ResolvedProviderConfig {
  const out = emptyProviderConfig();
  for (const [key, value] of Object.entries(block)) {
    const apply = PROVIDER_KNOBS[key];
    if (!apply) {
      throw cfgError(
        `unknown key "provider.${key}"; allowed: ${Object.keys(PROVIDER_KNOBS).join(', ')}`,
      );
    }
    apply(out, value, `provider.${key}`);
  }
  return out;
}

function parseLocalBlock(block: Record<string, unknown>): ResolvedLocalProviderConfig {
  const out = emptyProviderConfig().local;
  for (const [key, value] of Object.entries(block)) {
    const apply = LOCAL_KNOBS[key];
    if (!apply) {
      throw cfgError(
        `unknown key "provider.local.${key}"; allowed: ${Object.keys(LOCAL_KNOBS).join(', ')}`,
      );
    }
    apply(out, value, `provider.local.${key}`);
  }
  return out;
}
