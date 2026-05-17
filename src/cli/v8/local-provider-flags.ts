import * as fs from 'fs';
import * as path from 'path';
import type { ResolvedLocalProviderConfig } from '../../config/provider-config';
import { LOCAL_BACKEND_NAMES, type LocalBackendName } from '../../inference/local/factory';
import { LOCAL_GRAMMAR_MODES, type LocalGrammarMode } from './local-provider-types';
import {
  requireNonNegativeInt,
  requirePositiveInt,
  type ParseArgsOptions,
} from './argv-schema';
export { LOCAL_GRAMMAR_MODES };

/**
 * Shared parsing for the `--local-*` family of flags that configure the
 * local provider. All three argv-driven v8 handlers (`compile`, `run`,
 * `resume`) accept the same flag set; this module is the single source
 * of truth for their names, types, validation, and the precedence chain.
 *
 * Precedence the resolved values feed into:
 *
 *   flag value (this module) > env var > config file > default
 *
 * Resolution against env vars and config files happens downstream in the
 * provider factories. This module is responsible only for:
 *   - the parseArgs schema records the handlers spread into their own
 *     `options:` config (`LOCAL_PROVIDER_FLAG_SCHEMA`),
 *   - validating the parsed string values into a typed
 *     `LocalProviderFlagValues` struct (`buildLocalProviderFlagValues`),
 *   - the flag→env→config precedence resolver
 *     (`resolveEffectiveLocalProvider`).
 */



/** Resolved local-provider flag values, all optional. */
export interface LocalProviderFlagValues {
  backend: LocalBackendName | null;
  baseUrl: string | null;
  modelExtractor: string | null;
  modelSession: string | null;
  personaModelMap: Readonly<Record<string, string>> | null;
  grammar: LocalGrammarMode | null;
  requestTimeoutMs: number | null;
  maxConcurrency: number | null;
  apiKey: string | null;
  seed: number | null;
}

/**
 * `--local-*` flag tokens, derived from the schema keys. Exported for
 * pass-through-style argv walkers (e.g. benchmarks/provider-bench) that
 * need to recognize the local-provider family without invoking parseArgs
 * themselves. Schema is the source of truth; this constant is a view.
 */
export const LOCAL_PROVIDER_FLAG_TOKENS: readonly string[] = Object.freeze(
  [
    'local-backend',
    'local-base-url',
    'local-model-extractor',
    'local-model-session',
    'local-persona-model-map',
    'local-grammar',
    'local-request-timeout-ms',
    'local-max-concurrency',
    'local-api-key',
    'local-seed',
  ].map((k) => `--${k}`),
);

/** parseArgs schema records for every `--local-*` flag. */
export const LOCAL_PROVIDER_FLAG_SCHEMA: ParseArgsOptions = {
  'local-backend': { type: 'string' },
  'local-base-url': { type: 'string' },
  'local-model-extractor': { type: 'string' },
  'local-model-session': { type: 'string' },
  'local-persona-model-map': { type: 'string' },
  'local-grammar': { type: 'string' },
  'local-request-timeout-ms': { type: 'string' },
  'local-max-concurrency': { type: 'string' },
  'local-api-key': { type: 'string' },
  'local-seed': { type: 'string' },
};

/** Construct a struct with every field unset. */
export function emptyLocalProviderFlagValues(): LocalProviderFlagValues {
  return {
    backend: null,
    baseUrl: null,
    modelExtractor: null,
    modelSession: null,
    personaModelMap: null,
    grammar: null,
    requestTimeoutMs: null,
    maxConcurrency: null,
    apiKey: null,
    seed: null,
  };
}

/**
 * Translate the parseArgs `values` object into a typed
 * `LocalProviderFlagValues`. Throws on enum-invalid or range-invalid
 * input with the same message shape pre-3b emitted.
 *
 * `resolveModulePath` lets `--local-persona-model-map` resolve relative
 * paths against the handler-specific `repoRoot`.
 */
export function buildLocalProviderFlagValues(
  values: Record<string, unknown>,
  resolveModulePath: (raw: string) => string,
): LocalProviderFlagValues {
  const out = emptyLocalProviderFlagValues();
  const backend = stringOrNull(values, 'local-backend');
  if (backend !== null) {
    if (!LOCAL_BACKEND_NAMES.includes(backend as LocalBackendName)) {
      throw new Error(
        `invalid --local-backend "${backend}"; expected one of: ${LOCAL_BACKEND_NAMES.join(', ')}`,
      );
    }
    out.backend = backend as LocalBackendName;
  }
  out.baseUrl = stringOrNull(values, 'local-base-url');
  out.modelExtractor = stringOrNull(values, 'local-model-extractor');
  out.modelSession = stringOrNull(values, 'local-model-session');
  const map = stringOrNull(values, 'local-persona-model-map');
  if (map !== null) out.personaModelMap = parsePersonaModelMap(map, resolveModulePath);
  const grammar = stringOrNull(values, 'local-grammar');
  if (grammar !== null) {
    if (!LOCAL_GRAMMAR_MODES.includes(grammar as LocalGrammarMode)) {
      throw new Error(
        `invalid --local-grammar "${grammar}"; expected one of: ${LOCAL_GRAMMAR_MODES.join(', ')}`,
      );
    }
    out.grammar = grammar as LocalGrammarMode;
  }
  const reqTimeout = stringOrNull(values, 'local-request-timeout-ms');
  if (reqTimeout !== null) out.requestTimeoutMs = requirePositiveInt(reqTimeout, '--local-request-timeout-ms');
  const maxConc = stringOrNull(values, 'local-max-concurrency');
  if (maxConc !== null) out.maxConcurrency = requirePositiveInt(maxConc, '--local-max-concurrency');
  out.apiKey = stringOrNull(values, 'local-api-key');
  const seed = stringOrNull(values, 'local-seed');
  if (seed !== null) out.seed = requireNonNegativeInt(seed, '--local-seed');
  return out;
}

function stringOrNull(values: Record<string, unknown>, key: string): string | null {
  const v = values[key];
  return typeof v === 'string' ? v : null;
}

/**
 * Apply the precedence chain `flag > env > config > default` to the
 * local-provider fields. Returns a new `LocalProviderFlagValues` with
 * each field set to the highest-priority non-null value among the three
 * sources (or null if every source is unset; factory defaults take over).
 *
 * The env-var names match the existing factory's lookup keys.
 */
export function resolveEffectiveLocalProvider(
  fromFlag: LocalProviderFlagValues,
  fromConfig: ResolvedLocalProviderConfig,
  env: NodeJS.ProcessEnv = process.env,
): LocalProviderFlagValues {
  return {
    backend:
      fromFlag.backend ??
      (env['LOCAL_LLM_BACKEND'] && LOCAL_BACKEND_NAMES.includes(env['LOCAL_LLM_BACKEND'] as LocalBackendName)
        ? (env['LOCAL_LLM_BACKEND'] as LocalBackendName)
        : null) ??
      fromConfig.backend ??
      null,
    baseUrl: fromFlag.baseUrl ?? env['LOCAL_LLM_BASE_URL'] ?? fromConfig.baseUrl ?? null,
    modelExtractor:
      fromFlag.modelExtractor ??
      env['LOCAL_LLM_MODEL_EXTRACTOR'] ??
      fromConfig.modelExtractor ??
      null,
    modelSession:
      fromFlag.modelSession ??
      env['LOCAL_LLM_MODEL_SESSION'] ??
      fromConfig.modelSession ??
      null,
    personaModelMap: fromFlag.personaModelMap ?? fromConfig.personaModelMap ?? null,
    grammar:
      fromFlag.grammar ??
      (env['LOCAL_LLM_GRAMMAR'] && LOCAL_GRAMMAR_MODES.includes(env['LOCAL_LLM_GRAMMAR'] as LocalGrammarMode)
        ? (env['LOCAL_LLM_GRAMMAR'] as LocalGrammarMode)
        : null) ??
      fromConfig.grammar ??
      null,
    requestTimeoutMs:
      fromFlag.requestTimeoutMs ??
      readNumberEnv(env['LOCAL_LLM_REQUEST_TIMEOUT_MS']) ??
      fromConfig.requestTimeoutMs ??
      null,
    maxConcurrency:
      fromFlag.maxConcurrency ??
      readNumberEnv(env['LOCAL_LLM_MAX_CONCURRENCY']) ??
      fromConfig.maxConcurrency ??
      null,
    apiKey: fromFlag.apiKey ?? env['LOCAL_LLM_API_KEY'] ?? null,
    seed:
      fromFlag.seed ?? readNumberEnv(env['LOCAL_LLM_SEED']) ?? fromConfig.seed ?? null,
  };
}

function readNumberEnv(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse the value of `--local-persona-model-map`. Three accepted forms:
 *
 *   1. An inline JSON string: `'{"architect":"qwen2.5-coder:32b"}'`
 *   2. A path to a `.json` file containing such a map.
 *   3. A path to a `.yaml` / `.yml` file containing such a map.
 *
 * Returns a frozen `Record<string, string>`.
 */
function parsePersonaModelMap(
  raw: string,
  resolveModulePath: (raw: string) => string,
): Readonly<Record<string, string>> {
  const trimmed = raw.trim();
  let parsed: unknown;
  if (trimmed.startsWith('{')) {
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(
        `invalid --local-persona-model-map JSON: ${(err as Error).message}`,
        { cause: err },
      );
    }
  } else {
    const resolved = resolveModulePath(raw);
    let body: string;
    try {
      body = fs.readFileSync(resolved, 'utf8');
    } catch (err) {
      throw new Error(
        `--local-persona-model-map file "${resolved}" not readable: ${(err as Error).message}`,
        { cause: err },
      );
    }
    const ext = path.extname(resolved).toLowerCase();
    if (ext === '.json') {
      try {
        parsed = JSON.parse(body);
      } catch (err) {
        throw new Error(
          `--local-persona-model-map file "${resolved}" is not valid JSON: ${(err as Error).message}`,
          { cause: err },
        );
      }
    } else if (ext === '.yaml' || ext === '.yml') {
      parsed = parseYamlFlatMap(body, resolved);
    } else {
      throw new Error(
        `--local-persona-model-map: unsupported extension "${ext}" on "${resolved}"; expected .json, .yaml, or .yml`,
      );
    }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      '--local-persona-model-map must parse to a JSON/YAML object with string keys and string values',
    );
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v !== 'string') {
      throw new Error(
        `--local-persona-model-map["${k}"] must be a string; got ${typeof v}`,
      );
    }
    out[k] = v;
  }
  return Object.freeze(out);
}

// Minimal YAML flat-map parser: `key: value` per line, `#` comments,
// blank lines. Anything more elaborate is rejected with a corrective
// error; the wider YAML grammar isn't needed for this one tiny use case.
function parseYamlFlatMap(body: string, sourcePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = body.split(/\r?\n/);
  for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
    const raw = lines[lineNo] ?? '';
    const noComment = raw.replace(/(^|\s)#.*$/, '$1');
    const trimmed = noComment.trim();
    if (trimmed.length === 0) continue;
    const colon = trimmed.indexOf(':');
    if (colon <= 0) {
      throw new Error(
        `--local-persona-model-map: ${sourcePath}:${lineNo + 1}: ` +
          'expected `key: value` on each non-blank line',
      );
    }
    const key = trimmed.slice(0, colon).trim();
    let value = trimmed.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key.length === 0 || value.length === 0) {
      throw new Error(
        `--local-persona-model-map: ${sourcePath}:${lineNo + 1}: ` +
          'key and value must each be non-empty',
      );
    }
    out[key] = value;
  }
  return out;
}
