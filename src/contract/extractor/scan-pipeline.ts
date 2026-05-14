import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import * as yaml from 'js-yaml';
import { SUBMIT_CONTRACT_INPUT_SCHEMA, type ContractEnvelope } from './contract-schema';

/**
 * Shared scan-and-classify pipeline used by the non-Anthropic extractors
 * (deterministic, local, stub). Anthropic's tool-use loop bypasses both
 * the file parser and the AJV validator and so is intentionally not a
 * consumer here.
 */

export interface ContractValidationIssue {
  pointer: string;
  rule: string;
  message: string;
  fix: string;
}

/**
 * Name pinned to `DeterministicExtractorError` so the deterministic
 * extractor's existing public surface (and the `err instanceof` test
 * assertions) keep working after the move.
 */
export class DeterministicExtractorError extends Error {
  readonly issues: readonly ContractValidationIssue[];

  constructor(issues: readonly ContractValidationIssue[], summary: string) {
    super(summary);
    this.name = 'DeterministicExtractorError';
    this.issues = issues;
  }
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

export function envelopeSha(envelope: ContractEnvelope): string {
  return sha256Hex(JSON.stringify(envelope.obligations));
}

export function stripJsonFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n/i, '').replace(/\n?```\s*$/i, '');
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

export function loadEnvelopeFile(filePath: string): unknown {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) {
    throw fileError(`contract file not found: ${absolute}; check the --contract-file path`);
  }
  const raw = fs.readFileSync(absolute, 'utf8');
  const ext = path.extname(absolute).toLowerCase();
  if (ext === '.json') {
    return tryParse(() => JSON.parse(raw), absolute, 'JSON', 'YAML', '.yaml');
  }
  if (ext === '.yaml' || ext === '.yml') {
    return tryParse(() => yaml.load(raw), absolute, 'YAML', 'JSON', '.json');
  }
  throw fileError(
    `contract file ${absolute} has unsupported extension "${ext}"; use .json, .yaml, or .yml`,
  );
}

function fileError(message: string): DeterministicExtractorError {
  return new DeterministicExtractorError([], message);
}

function tryParse(
  parse: () => unknown,
  absolute: string,
  from: string,
  fallback: string,
  fallbackExt: string,
): unknown {
  try {
    return parse();
  } catch (err) {
    throw fileError(
      `contract file ${absolute} is not valid ${from}: ${(err as Error).message}; ` +
        `fix the ${from} syntax or use a ${fallbackExt} extension to parse as ${fallback}`,
    );
  }
}

export async function loadEnvelopeModule(modulePath: string): Promise<unknown> {
  const absolute = path.resolve(modulePath);
  if (!fs.existsSync(absolute)) {
    throw fileError(`contract module not found: ${absolute}; check the --contract-module path`);
  }
  let mod: { default?: unknown; [k: string]: unknown };
  try {
    mod = await import(absolute);
  } catch (err) {
    throw fileError(
      `failed to import contract module ${absolute}: ${(err as Error).message}; ` +
        `the module must be a TS/JS file the runtime can load`,
    );
  }
  return mod.default ?? mod;
}

export function validateContractEnvelope(raw: unknown, sourceLabel: string): ContractEnvelope {
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

function formatIssue(err: ErrorObject): ContractValidationIssue {
  return {
    pointer: err.instancePath || '',
    rule: err.keyword,
    message: err.message ?? '',
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
