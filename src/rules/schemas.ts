import * as fs from 'fs';
import * as path from 'path';
import Ajv, { type ValidateFunction } from 'ajv';

/**
 * The three rule artifact types the orchestrator's loader knows about.
 *
 * - `cheat-rule`: Semgrep-compatible cheat-detection rule plus orchestrator
 *   metadata. Consumed by the cheat detector.
 * - `property-template`: property-based test template. Consumed by the
 *   property gate (consumer wiring is foundation-only in v7; the gate's
 *   harness builders are still inline TS).
 * - `regression-fixture`: known-bug record. Consumed by the regression
 *   falsifier planned for v8; in v7 the schema lands so contributors know
 *   the data contract.
 */
export type RuleArtifactKind = 'cheat-rule' | 'property-template' | 'regression-fixture';

/** Result of validating a candidate rule object against a schema. */
export interface RuleValidationResult {
  valid: boolean;
  /** Ajv error array verbatim. Empty when valid. */
  errors: AjvErrorRecord[];
}

/** Subset of Ajv's ErrorObject preserved on failure for caller diagnostics. */
export interface AjvErrorRecord {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message?: string;
  params: Record<string, unknown>;
}

/**
 * Resolve the directory holding the bundled schema JSON files. Tries the
 * compile-output sibling (`__dirname/schemas`) first, then the source-tree
 * sibling so test runs against `dist/` and dev runs against `tsx` both
 * resolve. Throws when no candidate exists.
 */
function resolveSchemasDir(): string {
  const candidates = [
    path.join(__dirname, 'schemas'),
    path.join(__dirname, '..', '..', '..', 'src', 'rules', 'schemas'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    'rule schemas directory not found; expected one of: ' +
      candidates.join(', ') +
      '. Re-run `npm run build` to copy schemas into dist/.',
  );
}

const SCHEMA_FILENAMES: Readonly<Record<RuleArtifactKind, string>> = Object.freeze({
  'cheat-rule': 'cheat-rule.schema.json',
  'property-template': 'property-template.schema.json',
  'regression-fixture': 'regression-fixture.schema.json',
});

/** Lazily compiled validators, keyed by artifact kind. Cached to avoid re-compiling per call. */
const validatorCache = new Map<RuleArtifactKind, ValidateFunction>();

/** Lazily constructed Ajv instance shared across validators. */
let ajvInstance: Ajv | undefined;

function getAjv(): Ajv {
  if (!ajvInstance) {
    ajvInstance = new Ajv({ allErrors: true, strict: false });
  }
  return ajvInstance;
}

/** Read the raw JSON Schema for a given rule kind from disk. Exported for tests. */
export function loadSchema(kind: RuleArtifactKind): unknown {
  const dir = resolveSchemasDir();
  const file = path.join(dir, SCHEMA_FILENAMES[kind]);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function getValidator(kind: RuleArtifactKind): ValidateFunction {
  const cached = validatorCache.get(kind);
  if (cached) return cached;
  const schema = loadSchema(kind);
  const compiled = getAjv().compile(schema as object);
  validatorCache.set(kind, compiled);
  return compiled;
}

/**
 * Validate a candidate rule object against the schema for its declared kind.
 *
 * @param kind - Which rule schema to validate against.
 * @param candidate - Parsed YAML or JSON rule object.
 * @returns A result object; on failure, contains every Ajv error so the
 *          caller can surface a contributor-grade message.
 */
export function validateRule(kind: RuleArtifactKind, candidate: unknown): RuleValidationResult {
  const validator = getValidator(kind);
  const valid = validator(candidate);
  if (valid) return { valid: true, errors: [] };
  const errors = (validator.errors ?? []).map((err) => {
    const record: AjvErrorRecord = {
      instancePath: err.instancePath,
      schemaPath: err.schemaPath,
      keyword: err.keyword,
      params: err.params as Record<string, unknown>,
    };
    if (err.message !== undefined) record.message = err.message;
    return record;
  });
  return { valid: false, errors };
}
