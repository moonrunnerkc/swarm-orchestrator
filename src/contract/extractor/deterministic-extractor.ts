import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import * as yaml from 'js-yaml';
import {
  SUBMIT_CONTRACT_INPUT_SCHEMA,
  type ContractEnvelope,
} from './contract-schema';
import { type Extractor, type ExtractorInput, type ExtractorOutput } from './types';

/**
 * Source of a contract envelope for the deterministic extractor.
 * Exactly one form is provided per construction.
 */
export type ContractSource =
  | { kind: 'file'; path: string }
  | { kind: 'module'; path: string }
  | { kind: 'inline'; envelope: ContractEnvelope };

/** Construction options for {@link DeterministicExtractor}. */
export interface DeterministicExtractorOptions {
  source: ContractSource;
}

/**
 * Structured error thrown when the deterministic extractor rejects an
 * input. Each entry carries the JSON pointer to the offending field, the
 * rule that failed, and a one-line corrective action so the CLI handler
 * can surface a useful message without re-running anything.
 */
export class DeterministicExtractorError extends Error {
  readonly issues: readonly DeterministicValidationIssue[];

  constructor(issues: readonly DeterministicValidationIssue[], summary: string) {
    super(summary);
    this.name = 'DeterministicExtractorError';
    this.issues = issues;
  }
}

/** One validation issue, paired with a corrective hint. */
export interface DeterministicValidationIssue {
  /** JSON pointer to the offending location, e.g. `/obligations/2/path`. */
  pointer: string;
  /** Short rule name from Ajv (`required`, `enum`, `additionalProperties`, ...). */
  rule: string;
  /** Raw Ajv message; preserved so power users can grep. */
  message: string;
  /** One-line corrective action, derived from the rule + path. */
  fix: string;
}

/**
 * Deterministic extractor: accepts a hand-authored contract envelope from
 * a file (YAML or JSON), a TypeScript/JavaScript module's default export,
 * or an inline literal, validates it against the shared schema, and emits
 * the obligations unchanged. Performs zero inference.
 *
 * The provenance shape carries `name: 'deterministic'`, `model: null`,
 * `temperature: null`, and `promptSha256` set to the sha256 of the
 * canonicalized envelope bytes so the contract identity is reproducible
 * across runs.
 *
 * @throws {DeterministicExtractorError} when the source's contents fail
 *         validation against the shared contract schema.
 */
export class DeterministicExtractor implements Extractor {
  private readonly source: ContractSource;

  constructor(options: DeterministicExtractorOptions) {
    this.source = options.source;
  }

  /** Build from a YAML or JSON file path. */
  static fromFile(filePath: string): DeterministicExtractor {
    return new DeterministicExtractor({ source: { kind: 'file', path: filePath } });
  }

  /** Build from a TS/JS module whose default export is a `ContractEnvelope`. */
  static fromModule(modulePath: string): DeterministicExtractor {
    return new DeterministicExtractor({ source: { kind: 'module', path: modulePath } });
  }

  /** Build from an in-memory envelope (used by the inline-config path). */
  static fromInline(envelope: ContractEnvelope): DeterministicExtractor {
    return new DeterministicExtractor({ source: { kind: 'inline', envelope } });
  }

  async extract(_input: ExtractorInput): Promise<ExtractorOutput> {
    const raw = await this.loadRaw();
    const envelope = validateEnvelope(raw, this.sourceLabel());
    const canonical = JSON.stringify(envelope.obligations);
    const sha = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
    return {
      obligations: envelope.obligations,
      provenance: {
        name: 'deterministic',
        model: null,
        temperature: null,
        promptSha256: sha,
      },
    };
  }

  private async loadRaw(): Promise<unknown> {
    if (this.source.kind === 'inline') return this.source.envelope;
    if (this.source.kind === 'file') return loadFromFile(this.source.path);
    return loadFromModule(this.source.path);
  }

  private sourceLabel(): string {
    if (this.source.kind === 'inline') return '<inline>';
    return this.source.path;
  }
}

function loadFromFile(filePath: string): unknown {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) {
    throw new DeterministicExtractorError(
      [],
      `contract file not found: ${absolute}; check the --contract-file path`,
    );
  }
  const raw = fs.readFileSync(absolute, 'utf8');
  const ext = path.extname(absolute).toLowerCase();
  if (ext === '.json') {
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new DeterministicExtractorError(
        [],
        `contract file ${absolute} is not valid JSON: ${(err as Error).message}; ` +
          `fix the JSON syntax or use a .yaml extension to parse as YAML`,
      );
    }
  }
  if (ext === '.yaml' || ext === '.yml') {
    try {
      return yaml.load(raw);
    } catch (err) {
      throw new DeterministicExtractorError(
        [],
        `contract file ${absolute} is not valid YAML: ${(err as Error).message}; ` +
          `fix the YAML syntax or use a .json extension to parse as JSON`,
      );
    }
  }
  throw new DeterministicExtractorError(
    [],
    `contract file ${absolute} has unsupported extension "${ext}"; use .json, .yaml, or .yml`,
  );
}

async function loadFromModule(modulePath: string): Promise<unknown> {
  const absolute = path.resolve(modulePath);
  if (!fs.existsSync(absolute)) {
    throw new DeterministicExtractorError(
      [],
      `contract module not found: ${absolute}; check the --contract-module path`,
    );
  }
  let mod: { default?: unknown; [k: string]: unknown };
  try {
    mod = await import(absolute);
  } catch (err) {
    throw new DeterministicExtractorError(
      [],
      `failed to import contract module ${absolute}: ${(err as Error).message}; ` +
        `the module must be a TS/JS file the runtime can load`,
    );
  }
  const exported = mod.default ?? mod;
  return exported;
}

function validateEnvelope(raw: unknown, sourceLabel: string): ContractEnvelope {
  const validator = compiledValidator();
  if (!validator(raw)) {
    const issues = (validator.errors ?? []).map(formatIssue);
    const summary =
      `deterministic extractor rejected ${sourceLabel}: ` +
      `${issues.length} validation issue(s)\n` +
      issues.map((i) => `  - ${i.pointer || '/'}: ${i.fix}`).join('\n');
    throw new DeterministicExtractorError(issues, summary);
  }
  return raw as ContractEnvelope;
}

let cachedValidator: ValidateFunction | undefined;

function compiledValidator(): ValidateFunction {
  if (cachedValidator) return cachedValidator;
  const ajv = new Ajv({ allErrors: true, strict: false });
  cachedValidator = ajv.compile(SUBMIT_CONTRACT_INPUT_SCHEMA);
  return cachedValidator;
}

function formatIssue(err: ErrorObject): DeterministicValidationIssue {
  const pointer = err.instancePath || '';
  const rule = err.keyword;
  const message = err.message ?? '';
  return {
    pointer,
    rule,
    message,
    fix: correctiveActionFor(err),
  };
}

function correctiveActionFor(err: ErrorObject): string {
  const at = err.instancePath || '/';
  switch (err.keyword) {
    case 'required': {
      const params = err.params as { missingProperty?: string };
      const field = params.missingProperty ?? 'required field';
      return `add the missing "${field}" property at ${at}`;
    }
    case 'additionalProperties': {
      const params = err.params as { additionalProperty?: string };
      const field = params.additionalProperty ?? 'unknown';
      return `remove the unknown field "${field}" at ${at}`;
    }
    case 'enum': {
      const params = err.params as { allowedValues?: readonly unknown[] };
      const allowed = (params.allowedValues ?? []).map((v) => JSON.stringify(v)).join(', ');
      return `value at ${at} must be one of: ${allowed}`;
    }
    case 'const': {
      const params = err.params as { allowedValue?: unknown };
      return `value at ${at} must equal ${JSON.stringify(params.allowedValue)}`;
    }
    case 'type':
      return `value at ${at} must be of type ${(err.params as { type?: string }).type ?? 'expected'}`;
    case 'minLength':
      return `value at ${at} must be a non-empty string`;
    case 'minItems':
      return `array at ${at || '/obligations'} must contain at least one obligation`;
    case 'minimum':
    case 'maximum':
      return `value at ${at} is out of the allowed numeric range (${err.message ?? ''})`;
    case 'oneOf':
      return (
        `obligation at ${at} does not match any of the eight allowed obligation types ` +
        `(file-must-exist, build-must-pass, test-must-pass, function-must-have-signature, ` +
        `property-must-hold, import-graph-must-satisfy, coverage-must-exceed, ` +
        `performance-must-not-regress); check the "type" field and required properties`
      );
    default:
      return `${at} failed rule "${err.keyword}": ${err.message ?? 'see schema'}`;
  }
}
