import * as fs from 'fs';
import * as path from 'path';
import Ajv, { type ValidateFunction } from 'ajv';

/**
 * Load and compile the v1 obligation schema. Cached after first call so the
 * Ajv compilation cost is paid once per process.
 *
 * Schema JSON is read from disk (not `require()`d) so the TypeScript build
 * doesn't try to copy it implicitly; the `scripts/copy-non-ts-assets.js`
 * post-build hook places it next to the compiled loader at runtime.
 */
let cachedValidator: ValidateFunction | undefined;

function resolveSchemaPath(): string {
  const candidates = [
    path.join(__dirname, 'v1.json'),
    path.join(__dirname, '..', '..', '..', '..', 'src', 'contract', 'schema', 'v1.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    'contract schema v1.json not found; expected one of: ' +
      candidates.join(', ') +
      '. Re-run `npm run build` to copy schemas into dist/.',
  );
}

/** Read the raw v1 obligation schema JSON. Exported for tests. */
export function loadObligationSchema(): unknown {
  const file = resolveSchemaPath();
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Get the compiled Ajv validator for the v1 obligation schema. Validates a
 * single obligation object (one JSONL line), not a whole contract.
 */
export function obligationValidator(): ValidateFunction {
  if (cachedValidator) return cachedValidator;
  const ajv = new Ajv({ allErrors: true, strict: false });
  const schema = loadObligationSchema() as object;
  cachedValidator = ajv.compile(schema);
  return cachedValidator;
}

/** Reset the cached validator. Test helper only. */
export function resetSchemaCacheForTest(): void {
  cachedValidator = undefined;
}
