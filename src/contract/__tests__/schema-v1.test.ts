/**
 * @file Contract Schema v1 test suite.
 * @description Validates the contract schema against positive and negative examples
 *              for each obligation type, plus an unknown-type rejection test.
 */

import * as assert from "assert";
import { Ajv } from "ajv";
import type { AnySchema, ValidateFunction } from "ajv";
import { readFileSync } from "fs";
import { resolve } from "path";

const schemaPath = resolve(__dirname, "..", "schema", "v1.json");
const schema: AnySchema = JSON.parse(readFileSync(schemaPath, "utf8"));

// Register a minimal 2020-12 meta-schema under its own $id so ajv does not
// throw "no schema with key or ref" when it encounters the $schema URI in
// v1.json.  We only need the shape that matters for our schema: an object
// with $defs holding nested schemas.
const AJV_OPTIONS = { strict: false, allErrors: true, validateFormats: false };
const ajv = new Ajv(AJV_OPTIONS);

// Inline the 2020-12 meta-schema directly (no external $ref resolution needed).
const DRAFT_2020_12_META: AnySchema = {
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
       properties: { type: "object", additionalProperties: { $ref: "#" } },
       required: { type: "array", items: { type: "string" } },
       additionalProperties: { type: ["boolean", "object"] },
       items: { anyOf: [{ $ref: "#" }, { type: "array", items: { $ref: "#" } }] },
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
};

ajv.addSchema(DRAFT_2020_12_META, "https://json-schema.org/draft/2020-12/schema");

let validate: ValidateFunction;

before(() => {
  validate = ajv.compile(schema);
});

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

function assertValid(contract: Record<string, unknown>): void {
  const valid = validate(contract);
  if (!valid) {
    console.error("Validation errors:", (validate as unknown as { errors: unknown[] }).errors);
    assert.fail(
      `Expected valid but got errors: ${JSON.stringify((validate as any)?.errors)}`,
    );
  }
}

function assertInvalid(contract: Record<string, unknown>): void {
  const valid = validate(contract);
  assert.strictEqual(
    valid,
    false,
    `Expected invalid but validation passed: ${JSON.stringify((validate as any)?.errors)}`,
  );
}

describe("Contract Schema v1", () => {
  describe("file-must-exist obligation (positive)", () => {
    it("validates a minimal file-must-exist obligation", () => {
      assertValid(buildContract([
        { type: "file-must-exist", path: "src/index.ts" },
      ]));
    });

    it("validates file-must-exist with description", () => {
      assertValid(buildContract([
        {
          type: "file-must-exist",
          path: "src/api/handler.ts",
          description: "API handler file must be created",
        },
      ]));
    });
  });

  describe("build-must-pass obligation (positive)", () => {
    it("validates a minimal build-must-pass obligation", () => {
      assertValid(buildContract([
        { type: "build-must-pass", command: "npm run build" },
      ]));
    });

    it("validates build-must-pass with description", () => {
      assertValid(buildContract([
        {
          type: "build-must-pass",
          command: "tsc --noEmit",
          description: "TypeScript compilation must succeed",
        },
      ]));
    });
  });

  describe("test-must-pass obligation (positive)", () => {
    it("validates a minimal test-must-pass obligation", () => {
      assertValid(buildContract([
        { type: "test-must-pass", command: "npm test" },
      ]));
    });

    it("validates test-must-pass with description", () => {
      assertValid(buildContract([
        {
          type: "test-must-pass",
          command: "npm run test:integration",
          description: "Integration tests must pass",
        },
      ]));
    });
  });

  describe("mixed obligations (positive)", () => {
    it("validates all three obligation types together", () => {
      assertValid(buildContract([
        { type: "file-must-exist", path: "src/new.ts" },
        { type: "build-must-pass", command: "npm run build" },
        { type: "test-must-pass", command: "npm test" },
      ]));
    });
  });

  describe("file-must-exist obligation (negative)", () => {
    it("rejects file-must-exist missing required path field", () => {
      assertInvalid(buildContract([
        { type: "file-must-exist" },
      ]));
    });

    it("rejects file-must-exist with empty path", () => {
      assertInvalid(buildContract([
        { type: "file-must-exist", path: "" },
      ]));
    });

    it("rejects file-must-exist with wrong type value", () => {
      assertInvalid(buildContract([
        { type: "file-must-exist-wrong", path: "src/x.ts" },
      ]));
    });
  });

  describe("build-must-pass obligation (negative)", () => {
    it("rejects build-must-pass missing required command field", () => {
      assertInvalid(buildContract([
        { type: "build-must-pass" },
      ]));
    });

    it("rejects build-must-pass with empty command", () => {
      assertInvalid(buildContract([
        { type: "build-must-pass", command: "" },
      ]));
    });
  });

  describe("test-must-pass obligation (negative)", () => {
    it("rejects test-must-pass missing required command field", () => {
      assertInvalid(buildContract([
        { type: "test-must-pass" },
      ]));
    });

    it("rejects test-must-pass with empty command", () => {
      assertInvalid(buildContract([
        { type: "test-must-pass", command: "" },
      ]));
    });
  });

  describe("unknown obligation type (negative)", () => {
    it("rejects an unknown obligation type", () => {
      assertInvalid(buildContract([
        { type: "unknown-type", path: "some/path" },
      ]));
    });

    it("rejects a second unknown obligation type", () => {
      assertInvalid(buildContract([
        { type: "nonexistent-obligation", command: "fake cmd" },
      ]));
    });
  });

  describe("envelope validation (negative)", () => {
    it("rejects envelope missing $id", () => {
      const contract = buildContract([], { $id: undefined } as Record<string, unknown>);
      // Manually construct without $id
      const noId = {
        version: "1.0.0",
        obligations: [{ type: "file-must-exist", path: "src/x.ts" }],
      };
      assertInvalid(noId);
    });

    it("rejects envelope missing version", () => {
      const noVersion = {
        $id: "https://swarm-orchestrator.dev/schemas/contract/test.json",
        obligations: [{ type: "file-must-exist", path: "src/x.ts" }],
      };
      assertInvalid(noVersion);
    });

    it("rejects envelope with empty obligations array", () => {
      assertInvalid(buildContract([]));
    });

    it("rejects envelope with additional properties", () => {
      assertInvalid(
        buildContract([{ type: "file-must-exist", path: "src/x.ts" }], {
          extraField: "should not be allowed",
        }),
      );
    });
  });
});