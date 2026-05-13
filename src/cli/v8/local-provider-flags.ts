import * as fs from 'fs';
import * as path from 'path';
import { LOCAL_BACKEND_NAMES, type LocalBackendName } from '../../inference/local/factory';

/**
 * Shared parsing for the `--local-*` family of flags that configure the
 * local provider. All three v8 handlers (`compile`, `run`, `resume`) accept
 * exactly the same flag set; this module is the single source of truth
 * for their names, types, validation, and precedence rules.
 *
 * Precedence the resolved values feed into:
 *
 *   flag value (from this module) > env var > config file > default
 *
 * Resolution against env vars and config files happens downstream in the
 * provider factories. This module is responsible only for parsing the
 * flag tokens and surfacing a structured, typed `LocalProviderFlagValues`
 * object the caller folds into its own flag struct.
 */

/** Identifier for the local-session grammar mode. */
export type LocalGrammarMode = 'auto' | 'gbnf' | 'json-schema' | 'outlines' | 'none';

/** Identifiers accepted by `--local-grammar`. */
export const LOCAL_GRAMMAR_MODES: readonly LocalGrammarMode[] = [
  'auto',
  'gbnf',
  'json-schema',
  'outlines',
  'none',
] as const;

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
 * The set of flag tokens this module owns. Handlers consult this when
 * routing argv tokens to either the local-provider parser or their own
 * top-level dispatch.
 */
export const LOCAL_PROVIDER_FLAG_TOKENS: readonly string[] = [
  '--local-backend',
  '--local-base-url',
  '--local-model-extractor',
  '--local-model-session',
  '--local-persona-model-map',
  '--local-grammar',
  '--local-request-timeout-ms',
  '--local-max-concurrency',
  '--local-api-key',
  '--local-seed',
] as const;

/** True when the argv token names one of the local-provider flags. */
export function isLocalProviderFlag(arg: string): boolean {
  return LOCAL_PROVIDER_FLAG_TOKENS.includes(arg);
}

/**
 * Apply a single local-provider flag in place, given the index of the
 * flag token. The caller passes argv and the current index; this
 * function reads the value at argv[i+1], advances i, validates the
 * value's shape, and writes into `target`.
 *
 * Returns the new index the caller should continue from (i.e. the
 * index of the just-consumed value).
 *
 * @throws when the flag is unrecognized, missing a value, or carries
 *         an out-of-range / shape-invalid value.
 */
export function applyLocalProviderFlag(
  argv: readonly string[],
  index: number,
  target: LocalProviderFlagValues,
  resolveModulePath: (raw: string) => string,
): number {
  const flag = argv[index] ?? '';
  const valueIndex = index + 1;
  const raw = argv[valueIndex];
  if (raw === undefined || raw.startsWith('--')) {
    throw new Error(`flag ${flag} requires a value`);
  }

  switch (flag) {
    case '--local-backend': {
      if (!LOCAL_BACKEND_NAMES.includes(raw as LocalBackendName)) {
        throw new Error(
          `invalid --local-backend "${raw}"; expected one of: ${LOCAL_BACKEND_NAMES.join(', ')}`,
        );
      }
      target.backend = raw as LocalBackendName;
      break;
    }
    case '--local-base-url':
      target.baseUrl = raw;
      break;
    case '--local-model-extractor':
      target.modelExtractor = raw;
      break;
    case '--local-model-session':
      target.modelSession = raw;
      break;
    case '--local-persona-model-map':
      target.personaModelMap = parsePersonaModelMap(raw, resolveModulePath);
      break;
    case '--local-grammar': {
      if (!LOCAL_GRAMMAR_MODES.includes(raw as LocalGrammarMode)) {
        throw new Error(
          `invalid --local-grammar "${raw}"; expected one of: ${LOCAL_GRAMMAR_MODES.join(', ')}`,
        );
      }
      target.grammar = raw as LocalGrammarMode;
      break;
    }
    case '--local-request-timeout-ms': {
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(
          `invalid --local-request-timeout-ms "${raw}"; must be a positive integer`,
        );
      }
      target.requestTimeoutMs = n;
      break;
    }
    case '--local-max-concurrency': {
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(
          `invalid --local-max-concurrency "${raw}"; must be a positive integer`,
        );
      }
      target.maxConcurrency = n;
      break;
    }
    case '--local-api-key':
      target.apiKey = raw;
      break;
    case '--local-seed': {
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(`invalid --local-seed "${raw}"; must be a non-negative integer`);
      }
      target.seed = n;
      break;
    }
    default:
      throw new Error(`internal: applyLocalProviderFlag called with non-local flag "${flag}"`);
  }

  return valueIndex;
}

/**
 * Parse the value of `--local-persona-model-map`. Three accepted forms:
 *
 *   1. An inline JSON string: `'{"architect":"qwen2.5-coder:32b"}'`
 *   2. A path to a `.json` file containing such a map.
 *   3. A path to a `.yaml` / `.yml` file containing such a map.
 *
 * The discriminator is "starts with `{`" → inline; otherwise treat as a
 * filesystem path. Returns a frozen `Record<string, string>`.
 *
 * @throws when the value is neither valid JSON nor a readable file, when
 *         the file extension is unsupported, or when the parsed object
 *         is not a flat string-to-string map.
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

/**
 * Minimal YAML flat-map parser for `--local-persona-model-map`. Accepts
 * one `key: value` pair per line, with optional `#` comments and blank
 * lines. Anything more elaborate (nested objects, lists, anchors,
 * multi-line strings) is rejected with a corrective error. We
 * deliberately do not pull a YAML dependency for this one tiny use case.
 */
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
