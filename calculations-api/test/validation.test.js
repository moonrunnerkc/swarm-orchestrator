// Unit tests for request body validation (validateCreateBody, validateUpdateBody, validateUuid).
// Verifies field type checks, length limits, trimming, and error shapes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateCreateBody,
  validateUpdateBody,
  validateUuid,
} from "../src/validation.js";

const defaultCfg = {
  maxExpressionLength: 200,
  maxTitleLength: 100,
};

describe("validateCreateBody", () => {
  it("returns trimmed expression and null title when title omitted", () => {
    const result = validateCreateBody({ expression: " 1 + 2 " }, defaultCfg);
    assert.strictEqual(result.expression, "1 + 2");
    assert.strictEqual(result.title, null);
  });

  it("returns trimmed expression and title", () => {
    const result = validateCreateBody(
      { expression: "3*4", title: "  my calc  " },
      defaultCfg,
    );
    assert.strictEqual(result.expression, "3*4");
    assert.strictEqual(result.title, "my calc");
  });

  it("coerces whitespace-only title to null", () => {
    const result = validateCreateBody(
      { expression: "1+1", title: "   " },
      defaultCfg,
    );
    assert.strictEqual(result.title, null);
  });

  it("accepts explicit null title", () => {
    const result = validateCreateBody(
      { expression: "1+1", title: null },
      defaultCfg,
    );
    assert.strictEqual(result.title, null);
  });

  it("throws ValidationError for non-object body (null)", () => {
    assert.throws(
      () => validateCreateBody(null, defaultCfg),
      (err) => err.status === 400 && /JSON object/.test(err.message),
    );
  });

  it("throws ValidationError for array body", () => {
    assert.throws(
      () => validateCreateBody([1, 2], defaultCfg),
      (err) => err.status === 400 && /JSON object/.test(err.message),
    );
  });

  it("throws ValidationError for non-string expression", () => {
    assert.throws(
      () => validateCreateBody({ expression: 123 }, defaultCfg),
      (err) => err.status === 400 && /string/.test(err.message),
    );
  });

  it("throws ValidationError for missing expression", () => {
    assert.throws(
      () => validateCreateBody({ title: "no expr" }, defaultCfg),
      (err) => err.status === 400,
    );
  });

  it("throws ValidationError for empty expression", () => {
    assert.throws(
      () => validateCreateBody({ expression: "   " }, defaultCfg),
      (err) => err.status === 400 && /empty/.test(err.message),
    );
  });

  it("throws for expression exceeding maxExpressionLength", () => {
    const longExpr = "1+" + "1".repeat(250);
    assert.throws(
      () => validateCreateBody({ expression: longExpr }, defaultCfg),
      (err) => err.status === 400 && /exceeds maximum/.test(err.message),
    );
  });

  it("throws for title exceeding maxTitleLength", () => {
    const longTitle = "x".repeat(101);
    assert.throws(
      () => validateCreateBody({ expression: "1+1", title: longTitle }, defaultCfg),
      (err) => err.status === 400 && /exceeds maximum/.test(err.message),
    );
  });

  it("throws for non-string title (number)", () => {
    assert.throws(
      () => validateCreateBody({ expression: "1+1", title: 42 }, defaultCfg),
      (err) => err.status === 400 && /string or null/.test(err.message),
    );
  });
});

describe("validateUpdateBody", () => {
  it("accepts expression-only update", () => {
    const result = validateUpdateBody({ expression: "5+5" }, defaultCfg);
    assert.strictEqual(result.expression, "5+5");
    assert.strictEqual(result.title, undefined);
  });

  it("accepts title-only update", () => {
    const result = validateUpdateBody({ title: "new name" }, defaultCfg);
    assert.strictEqual(result.title, "new name");
    assert.strictEqual(result.expression, undefined);
  });

  it("accepts both expression and title", () => {
    const result = validateUpdateBody(
      { expression: "9-1", title: "updated" },
      defaultCfg,
    );
    assert.strictEqual(result.expression, "9-1");
    assert.strictEqual(result.title, "updated");
  });

  it("throws when body is empty object (no fields)", () => {
    assert.throws(
      () => validateUpdateBody({}, defaultCfg),
      (err) =>
        err.status === 400 &&
        /at least one/.test(err.message),
    );
  });

  it("throws for non-object body", () => {
    assert.throws(
      () => validateUpdateBody("string", defaultCfg),
      (err) => err.status === 400 && /JSON object/.test(err.message),
    );
  });

  it("throws for non-string expression in update", () => {
    assert.throws(
      () => validateUpdateBody({ expression: true }, defaultCfg),
      (err) => err.status === 400 && /string/.test(err.message),
    );
  });
});

describe("validateUuid", () => {
  it("accepts valid lowercase UUID v4", () => {
    const uuid = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
    assert.strictEqual(validateUuid(uuid), uuid);
  });

  it("lowercases uppercase UUID", () => {
    const uuid = "A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D";
    assert.strictEqual(validateUuid(uuid), uuid.toLowerCase());
  });

  it("rejects non-v4 UUID (wrong version digit)", () => {
    assert.throws(
      () => validateUuid("a1b2c3d4-e5f6-1a7b-8c9d-0e1f2a3b4c5d"),
      (err) => err.status === 400 && /UUID v4/.test(err.message),
    );
  });

  it("rejects random string", () => {
    assert.throws(
      () => validateUuid("not-a-uuid"),
      (err) => err.status === 400 && /UUID v4/.test(err.message),
    );
  });

  it("rejects empty string", () => {
    assert.throws(
      () => validateUuid(""),
      (err) => err.status === 400,
    );
  });

  it("includes custom paramName in error message", () => {
    assert.throws(
      () => validateUuid("bad", "calcId"),
      (err) => err.status === 400 && /calcId/.test(err.message),
    );
  });
});
