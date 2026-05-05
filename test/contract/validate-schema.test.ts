/**
 * Tests for validateContract and a schema-types sync assertion.
 *
 * Covers: 3 valid fixtures (one per obligation type), 6 invalid
 * fixtures (missing required fields, wrong types, unknown obligation
 * kind, malformed payloads per kind), and a sync test that loads
 * v1.json and asserts every obligation kind appears in the TS union.
 */
import * as assert from "assert";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
// projectRoot: test/contract/validate-schema.test.ts -> ../../..
const projectRoot = resolve(__dirname, "../../..");
import {
  type ObligationKind,
  isFileMustExist,
  isBuildMustPass,
  isTestMustPass,
} from "../../src/contract/types";
import { validateContract } from "../../src/contract/validate-schema";
// Test directories for the sync assertion.
const srcDir = resolve(projectRoot, "src");
const contractDir = resolve(srcDir, "contract");
const schemaDir = resolve(contractDir, "schema");
const testDir = resolve(projectRoot, "test", "contract");
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildContract(
  obligations: unknown[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
     $id: "https://swarm-orchestrator.dev/schemas/contract/test-envelope.json",
    version: "1.0.0",
    obligations,
     ...overrides,
   };
}
// File-must-exist valid (minimal + with description)
const fileObligationMinimal = {
  type: "file-must-exist" as const,
  path: "src/new-file.ts",
};
const fileObligationFull = {
  type: "file-must-exist" as const,
  path: "src/new-file.ts",
  description: "New file must be created",
};
// build-must-pass valid
const buildObligationMinimal = {
  type: "build-must-pass" as const,
  command: "npm run build",
};
const buildObligationFull = {
  type: "build-must-pass" as const,
  command: "npm run build",
  description: "Build step must pass",
};
// test-must-pass valid
const testObligationMinimal = {
  type: "test-must-pass" as const,
  command: "npm test",
};
const testObligationFull = {
  type: "test-must-pass" as const,
  command: "npm test",
  description: "Unit tests must pass",
};
// ---------------------------------------------------------------------------
// Valid fixtures
// ---------------------------------------------------------------------------
describe("validateContract", () => {
  describe("valid fixtures", () => {
    it("file-must-exist (minimal) returns ok", () => {
      const result = validateContract(
        buildContract([fileObligationMinimal]),
      );
      assert.strictEqual(result.ok, true);
    });
    it("build-must-pass (minimal) returns ok", () => {
      const result = validateContract(
        buildContract([buildObligationMinimal]),
      );
      assert.strictEqual(result.ok, true);
    });
    it("test-must-pass (minimal) returns ok", () => {
      const result = validateContract(
        buildContract([testObligationMinimal]),
      );
      assert.strictEqual(result.ok, true);
    });
    it("mixed obligations across all three types returns ok", () => {
      const result = validateContract(
        buildContract([
          fileObligationMinimal,
          buildObligationMinimal,
          testObligationMinimal,
        ], { extraField: "should not exist" }),
      );
      // extraField makes it invalid via additionalProperties
      assert.strictEqual(result.ok, false);
      // Without the extra field
      const validResult = validateContract(
        buildContract([
          fileObligationMinimal,
          buildObligationMinimal,
          testObligationMinimal,
        ]),
      );
      assert.strictEqual(validResult.ok, true);
    });
    it("type guards narrow correctly for each kind", () => {
      const file = fileObligationMinimal;
      assert.strictEqual(isFileMustExist(file), true);
      assert.strictEqual(isBuildMustPass(file), false);
      assert.strictEqual(isTestMustPass(file), false);
      const build = buildObligationMinimal;
      assert.strictEqual(isFileMustExist(build), false);
      assert.strictEqual(isBuildMustPass(build), true);
      assert.strictEqual(isTestMustPass(build), false);
      const test = testObligationMinimal;
      assert.strictEqual(isFileMustExist(test), false);
      assert.strictEqual(isBuildMustPass(test), false);
      assert.strictEqual(isTestMustPass(test), true);
    });
  });
  // ---------------------------------------------------------------------------
  // Invalid fixtures
  // ---------------------------------------------------------------------------
  describe("invalid fixtures", () => {
    // 1. file-must-exist: missing required `path` field
    it("rejects file-must-exist missing 'path' field and includes field path", () => {
      const result = validateContract(
        buildContract([{ type: "file-must-exist" }]),
      );
      assert.strictEqual(result.ok, false);
      assert.ok(
        result.errors.some((e) =>
          e.fieldPath.includes("path") ||
          e.message.includes("path"),
        ),
        "Expected error to include 'path' field",
      );
    });
    // 2. file-must-exist: empty `path` (minLength violation)
    it("rejects file-must-exist with empty 'path' field", () => {
      const result = validateContract(
        buildContract([{ type: "file-must-exist", path: "" }]),
      );
      assert.strictEqual(result.ok, false);
      assert.ok(
        result.errors.some((e) => e.expected === "a non-empty string"),
        "Expected error to mention 'a non-empty string'",
      );
    });
    // 3. build-must-pass: missing required `command` field
    it("rejects build-must-pass missing 'command' field", () => {
      const result = validateContract(
        buildContract([{ type: "build-must-pass" }]),
      );
      assert.strictEqual(result.ok, false);
      assert.ok(
        result.errors.some((e) =>
          e.fieldPath.includes("command") ||
          e.message.includes("command"),
        ),
        "Expected error to include 'command' field",
      );
    });
    // 4. test-must-pass: empty `command` (minLength violation)
    it("rejects test-must-pass with empty command", () => {
      const result = validateContract(
        buildContract([{ type: "test-must-pass", command: "" }]),
      );
      assert.strictEqual(result.ok, false);
      assert.ok(
        result.errors.some((e) => e.expected === "a non-empty string"),
        "Expected error to mention 'a non-empty string'",
      );
    });
    // 5. Unknown obligation type
    it("rejects unknown obligation kind", () => {
      const result = validateContract(
        buildContract([{ type: "nonexistent-type", path: "a.ts" }]),
      );
      assert.strictEqual(result.ok, false);
      assert.ok(
        result.errors.some((e) =>
          e.expected.includes("file-must-exist") &&
          e.expected.includes("build-must-pass") &&
          e.expected.includes("test-must-pass"),
        ),
        "Expected error to list all valid obligation kinds",
      );
    });
    // 6. Envelope missing required `$id` field
    it("rejects envelope missing required '$id' field", () => {
      const noId = {
        version: "1.0.0",
        obligations: [fileObligationMinimal],
      };
      const result = validateContract(noId);
      assert.strictEqual(result.ok, false);
      assert.ok(
        result.errors.some((e) =>
          e.expected.includes("$id") ||
          e.fieldPath.includes("$id"),
        ),
        "Expected error to mention '$id'",
      );
    });
    // 7. Envelope with empty obligations array (minItems)
    it("rejects envelope with empty obligations array", () => {
      const result = validateContract(buildContract([]));
      assert.strictEqual(result.ok, false);
      assert.ok(
        result.errors.some((e) =>
          e.expected.includes("a non-empty array"),
        ),
        "Expected error to mention 'a non-empty array'",
      );
    });
  });
  // ---------------------------------------------------------------------------
  // Schema-types sync test
  // ---------------------------------------------------------------------------
  describe("schema-types sync", () => {
    it("every defined obligation kind appears in TS file", () => {
      // Build paths relative to project root (test/contract/ -> ../..).
      const schemaPath = resolve(projectRoot, "src", "contract", "schema", "v1.json");
      const rawSchema = readFileSync(schemaPath, "utf-8") as string;
      const schema = JSON.parse(rawSchema) as {
          $defs: Record<string, unknown>;
        };
      const knownKinds = Object.keys(schema.$defs);
      // Known kinds from v1.json: file-must-exist, build-must-pass, test-must-pass
      assert.ok(
        knownKinds.includes("file-must-exist"),
        "schema must define file-must-exist",
      );
      assert.ok(
        knownKinds.includes("build-must-pass"),
        "schema must define build-must-pass",
      );
      assert.ok(
        knownKinds.includes("test-must-pass"),
        "schema must define test-must-pass",
      );
      const kindCount = knownKinds.length;
      assert.ok(kindCount === 3, `expected exactly 3 obligation kinds, got ${kindCount}`);
      // Verify the TS types file contains all obligation kinds.
      const tsTypesFile = resolve(projectRoot, "src", "contract", "types.ts");
      assert.ok(existsSync(tsTypesFile), `types.ts must exist at ${tsTypesFile}`);
      const tsContent = readFileSync(tsTypesFile, "utf-8");
      for (const kind of knownKinds) {
        assert.ok(
          tsContent.includes(`"${kind}"`),
            `TS types must contain obligation kind "${kind}"`,
        );
      }
      // Verify the validation test file also references each kind.
      const testFile = resolve(testDir, "validate-schema.test.ts");
      const testContent = readFileSync(testFile, "utf-8");
      for (const kind of knownKinds) {
        assert.ok(
          testContent.includes(kind),
            `Test file must reference obligation kind "${kind}"`,
        );
      }
    });
  });
});
