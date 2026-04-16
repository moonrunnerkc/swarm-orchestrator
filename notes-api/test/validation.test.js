// Unit tests for request body validation.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateCreateBody,
  validateUpdateBody,
  validateUuid,
} from "../src/validation.js";

const defaultCfg = {
  maxTitleLength: 200,
  maxContentLength: 10_000,
};

describe("validateCreateBody", () => {
  it("returns trimmed title and content", () => {
    const result = validateCreateBody(
      { title: "  My Note  ", content: "  body  " },
      defaultCfg,
    );
    assert.strictEqual(result.title, "My Note");
    assert.strictEqual(result.content, "body");
  });

  it("defaults content to empty string when omitted", () => {
    const result = validateCreateBody({ title: "Title only" }, defaultCfg);
    assert.strictEqual(result.content, "");
  });

  it("defaults content to empty string when null", () => {
    const result = validateCreateBody(
      { title: "Title", content: null },
      defaultCfg,
    );
    assert.strictEqual(result.content, "");
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

  it("throws ValidationError when title is missing", () => {
    assert.throws(
      () => validateCreateBody({ content: "no title" }, defaultCfg),
      (err) => err.status === 400 && /title.*required/.test(err.message),
    );
  });

  it("throws ValidationError for non-string title", () => {
    assert.throws(
      () => validateCreateBody({ title: 123 }, defaultCfg),
      (err) => err.status === 400 && /string/.test(err.message),
    );
  });

  it("throws ValidationError for empty title after trim", () => {
    assert.throws(
      () => validateCreateBody({ title: "   " }, defaultCfg),
      (err) => err.status === 400 && /empty/.test(err.message),
    );
  });

  it("throws for title exceeding maxTitleLength", () => {
    const longTitle = "x".repeat(201);
    assert.throws(
      () => validateCreateBody({ title: longTitle }, defaultCfg),
      (err) => err.status === 400 && /exceeds maximum/.test(err.message),
    );
  });

  it("throws for non-string content (number)", () => {
    assert.throws(
      () => validateCreateBody({ title: "ok", content: 42 }, defaultCfg),
      (err) => err.status === 400 && /string/.test(err.message),
    );
  });

  it("throws for content exceeding maxContentLength", () => {
    const longContent = "x".repeat(10_001);
    assert.throws(
      () => validateCreateBody({ title: "ok", content: longContent }, defaultCfg),
      (err) => err.status === 400 && /exceeds maximum/.test(err.message),
    );
  });
});

describe("validateUpdateBody", () => {
  it("accepts title-only update", () => {
    const result = validateUpdateBody({ title: "new name" }, defaultCfg);
    assert.strictEqual(result.title, "new name");
    assert.strictEqual(result.content, undefined);
  });

  it("accepts content-only update", () => {
    const result = validateUpdateBody({ content: "new body" }, defaultCfg);
    assert.strictEqual(result.content, "new body");
    assert.strictEqual(result.title, undefined);
  });

  it("accepts both title and content", () => {
    const result = validateUpdateBody(
      { title: "updated", content: "new text" },
      defaultCfg,
    );
    assert.strictEqual(result.title, "updated");
    assert.strictEqual(result.content, "new text");
  });

  it("throws when body is empty object (no fields)", () => {
    assert.throws(
      () => validateUpdateBody({}, defaultCfg),
      (err) => err.status === 400 && /at least one/.test(err.message),
    );
  });

  it("throws for non-object body", () => {
    assert.throws(
      () => validateUpdateBody("string", defaultCfg),
      (err) => err.status === 400 && /JSON object/.test(err.message),
    );
  });

  it("throws for non-string content in update", () => {
    assert.throws(
      () => validateUpdateBody({ content: true }, defaultCfg),
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
      () => validateUuid("bad", "noteId"),
      (err) => err.status === 400 && /noteId/.test(err.message),
    );
  });
});
