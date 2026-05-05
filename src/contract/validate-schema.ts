/**
 * Runtime schema validator for contract envelopes.
 *
 * Chosen tool: AJV (already a project dependency, see package.json).
 * Rationale: ajv compiles to fast inline functions with no runtime
 * overhead, supports JSON Schema Draft 2020-12 natively, and
 * produces structured error objects with dataPath/location info.
 *
 * @packageDocumentation
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { Ajv, type ValidateFunction, type AnySchema } from "ajv";

const SCHEMA_PATH = resolve(__dirname, "schema", "v1.json");

const AJV_OPTIONS = {
  strict: false,
  allErrors: true,
  validateFormats: false,
};

// Cached compiled validator instance.
let compiledValidator: ValidateFunction | null = null;

function ensureValidator(): ValidateFunction {
  if (compiledValidator != null) return compiledValidator;

  const schema: AnySchema = JSON.parse(
    readFileSync(SCHEMA_PATH, "utf-8"),
  );
  const ajv = new Ajv(AJV_OPTIONS);
   // Register an inline Draft 2020-12 meta-schema so ajv does not
   // resolve external $refs at load time.
  ajv.addSchema({
     $id: "https://json-schema.org/draft/2020-12/schema",
     $defs: {
       schemaMap: {
         type: "object",
         additionalProperties: { $ref: "#" },
        },
      },
     type: ["object", "array"],
     properties: {
        $schema: { type: "string" },
        $id: { type: "string" },
        $ref: { type: "string" },
        $defs: { $ref: "#/$defs/schemaMap" },
        $comment: { type: "string" },
       type: { type: ["string", "array"] },
       properties: {
         type: "object",
         additionalProperties: { $ref: "#" },
        },
       required: {
         type: "array",
         items: { type: "string" },
        },
       additionalProperties: {
         type: ["boolean", "object"],
        },
       items: {
         anyOf: [
           { $ref: "#" },
           { type: "array", items: { $ref: "#" } },
         ],
        },
       allOf: { type: "array", items: { $ref: "#" } },
       anyOf: { type: "array", items: { $ref: "#" } },
       oneOf: { type: "array", items: { $ref: "#" } },
       not: { $ref: "#" },
       prefixItems: { type: "array", items: { $ref: "#" } },
       minItems: { type: "number" },
       maxItems: { type: "number" },
       minLength: { type: "number" },
       maxLength: { type: "number" },
       minimum: { type: "number" },
       maximum: { type: "number" },
       pattern: { type: "string" },
       description: { type: "string" },
       title: { type: "string" },
      },
     additionalProperties: true,
    }, "https://json-schema.org/draft/2020-12/schema");
  compiledValidator = ajv.compile(schema);
  return compiledValidator;
}

/**
 * A validation error with enough context for the caller to fix it.
 */
export interface ValidationError {
  readonly fieldPath: string;
  readonly message: string;
  readonly expected: string;
}

/**
 * Result of validateContract: either a satisfied contract or a set
 * of human-readable errors.
 */
export type ValidationResult =
   | { ok: true; contract: unknown }
   | { ok: false; errors: ValidationError[] };

/**
 * Convert an AJV dataPath (e.g. "/obligations/0/path") into a flat
 * dotted path (e.g. "obligations.0.path") for the error report.
 * Handles nullable dataPath from AJV on root-level errors.
 */
function buildErrorLabel(dataPath: string | null): string {
  if (dataPath == null || dataPath.length === 0) return "envelope";
  return dataPath.replace(/^\//, "").replace(/\//g, ".");
}

/**
 * Validate a JSON object against the v1 contract schema.
 *
 * @param input - The raw contract object to validate.
 * @returns An `{ ok: true, contract }` on success or `{ ok: false, errors }`
 *          describing each failure with field path and expected type.
 */
export function validateContract(
  input: unknown,
): ValidationResult {
  const validate = ensureValidator();
  const valid = validate(input);

  if (valid) {
    return { ok: true, contract: input };
   }

   // AJV mutates the validate function at runtime to attach `errors`.
   // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ajvErrors: Array<{
    dataPath: string | null;
    keyword: string;
    params: Record<string, unknown>;
    message: string;
   }> = (validate as any).errors ?? [];

  if (ajvErrors.length > 0) {
    const errors: ValidationError[] = ajvErrors.map((err) => {
      const fieldPath = buildErrorLabel(err.dataPath);
       // Produce a helpful expected-type hint from the validation keyword.
      let expected: string;
      switch (err.keyword) {
        case "required":
          expected = `required field "${(err.params as any).missingProperty}"`;
          break;
        case "type":
          expected = "type string";
          break;
        case "const":
          expected = "one of: file-must-exist, build-must-pass, test-must-pass";
          break;
        case "minLength":
          expected = "a non-empty string";
          break;
        case "minItems":
          expected = "a non-empty array (at least 1 item)";
          break;
        case "additionalProperties":
          expected = "no additional properties";
          break;
        default:
          expected = err.keyword;
       }
      return {
        fieldPath,
        message: err.message ?? `Schema violation at "${fieldPath}"`,
        expected,
       };
     });
    return { ok: false, errors };
   }

  return {
    ok: false,
    errors: [
       {
        fieldPath: "root",
        message: "Validation failed",
        expected: "valid contract envelope",
       },
     ],
   };
}
