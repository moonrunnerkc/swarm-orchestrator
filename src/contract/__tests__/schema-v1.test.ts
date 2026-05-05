/**
 * @file Contract Schema v1 test suite.
 * @description Validates the contract schema against positive and negative examples.
 */

import * as assert from "assert";
import { Ajv, ValidateFunction } from "ajv";
import { readFileSync } from "fs";
import { resolve } from "path";

// Initialize Ajv
const ajv = new Ajv({ strict: false });

// Resolve schema path relative to source root
const schemaPath = resolve(__dirname, "..", "schema", "v1.json");
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

// Compile the schema validator
let validate: ValidateFunction;

describe("Contract Schema v1", () => {
  before(() => {
    validate = ajv.compile(schema);
  });

  describe("Positive cases", () => {
    it("should validate file-must-exist obligation", () => {
      const validObligation = {
        $id: "https://swarm-orchestrator.dev/schemas/contract/test-file-must-exist.json",
        version: "1.0.0",
        obligations: [
          {
            type: "file-must-exist",
            path: "src/index.ts",
            description: "Main entry point file must be created"
          }
        ]
      };

      const valid = validate(validObligation);
      if (!valid && ajv.errors) {
        console.error("Validation errors:", ajv.errors);
      }
      assert.strictEqual(valid, true);
    });

    it("should validate build-must-pass obligation", () => {
      const validObligation = {
        $id: "https://swarm-orchestrator.dev/schemas/contract/test-build-must-pass.json",
        version: "1.0.0",
        obligations: [
          {
            type: "build-must-pass",
            command: "npm run build",
            description: "Project must build without errors"
          }
        ]
      };

      const valid = validate(validObligation);
      if (!valid && ajv.errors) {
        console.error("Validation errors:", ajv.errors);
      }
      assert.strictEqual(valid, true);
    });

    it("should validate test-must-pass obligation", () => {
      const validObligation = {
        $id: "https://swarm-orchestrator.dev/schemas/contract/test-test-must-pass.json",
        version: "1.0.0",
        obligations: [
          {
            type: "test-must-pass",
            command: "npm test",
            description: "All tests must pass"
          }
        ]
      };

      const valid = validate(validObligation);
      if (!valid && ajv.errors) {
        console.error("Validation errors:", ajv.errors);
      }
      assert.strictEqual(valid, true);
    });

    it("should validate multiple obligations of different types", () => {
      const validObligation = {
        $id: "https://swarm-orchestrator.dev/schemas/contract/test-mixed.json",
        version: "1.0.0",
        obligations: [
          {
            type: "file-must-exist",
            path: "src/index.ts"
          },
          {
            type: "build-must-pass",
            command: "npm run build"
          },
          {
            type: "test-must-pass",
            command: "npm test"
          }
        ]
      };

      const valid = validate(validObligation);
      if (!valid && ajv.errors) {
        console.error("Validation errors:", ajv.errors);
      }
      assert.strictEqual(valid, true);
    });
  });

  describe("Negative cases", () => {
    it("should reject unknown obligation type", () => {
      const invalidObligation = {
        $id: "https://swarm-orchestrator.dev/schemas/contract/test-unknown.json",
        version: "1.0.0",
        obligations: [
          {
            type: "unknown-type",
            path: "some/path"
          }
        ]
      };

      const valid = validate(invalidObligation);
      assert.strictEqual(valid, false);
    });

    it("should reject missing required field in file-must-exist", () => {
      const invalidObligation = {
        $id: "https://swarm-orchestrator.dev/schemas/contract/test-missing-path.json",
        version: "1.0.0",
        obligations: [
          {
            type: "file-must-exist"
            // Missing required 'path' field
          }
        ]
      };

      const valid = validate(invalidObligation);
      assert.strictEqual(valid, false);
    });

    it("should reject missing required field in build-must-pass", () => {
      const invalidObligation = {
        $id: "https://swarm-orchestrator.dev/schemas/contract/test-missing-command.json",
        version: "1.0.0",
        obligations: [
          {
            type: "build-must-pass"
            // Missing required 'command' field
          }
        ]
      };

      const valid = validate(invalidObligation);
      assert.strictEqual(valid, false);
    });

    it("should reject additional properties", () => {
      const invalidObligation = {
        $id: "https://swarm-orchestrator.dev/schemas/contract/test-additional.json",
        version: "1.0.0",
        obligations: [
          {
            type: "file-must-exist",
            path: "src/index.ts",
            extraField: "should not be allowed"
          }
        ]
      };

      const valid = validate(invalidObligation);
      assert.strictEqual(valid, false);
    });
  });

  describe("Envelope validation", () => {
    it("should reject missing required envelope fields", () => {
      const invalidObligation = {
        // Missing $id
        version: "1.0.0",
        obligations: [
          {
            type: "file-must-exist",
            path: "src/index.ts"
          }
        ]
      };

      const valid = validate(invalidObligation);
      assert.strictEqual(valid, false);
    });
  });
});
