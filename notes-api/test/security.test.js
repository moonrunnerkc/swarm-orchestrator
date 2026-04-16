// Tests for security headers middleware and sanitisation helpers.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { makeApp } from "../src/app.js";
import { sanitiseForReflection, SECURITY_HEADERS } from "../src/security.js";

const { app } = makeApp({
  config: {
    port: 0,
    host: "127.0.0.1",
    dataFile: "/tmp/notes-sec-test.json",
    corsOrigin: "*",
    logRequests: false,
    maxTitleLength: 200,
    maxContentLength: 10_000,
    maxBodyBytes: 65536,
  },
});

describe("security headers", () => {
  it("sets all required security headers", async () => {
    const res = await request(app).get("/health").expect(200);
    for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
      assert.strictEqual(
        res.headers[header.toLowerCase()],
        value,
        `expected ${header}: ${value}`,
      );
    }
  });

  it("does not expose x-powered-by", async () => {
    const res = await request(app).get("/health");
    assert.strictEqual(res.headers["x-powered-by"], undefined);
  });
});

describe("sanitiseForReflection", () => {
  it("passes through short safe strings unchanged", () => {
    assert.strictEqual(sanitiseForReflection("hello"), "hello");
  });

  it("strips control characters", () => {
    assert.strictEqual(sanitiseForReflection("a\x00b\x1fc"), "abc");
  });

  it("truncates long strings with ellipsis", () => {
    const long = "a".repeat(250);
    const result = sanitiseForReflection(long);
    assert.strictEqual(result.length, 203); // 200 + "..."
    assert.ok(result.endsWith("..."));
  });

  it("converts non-strings to string", () => {
    assert.strictEqual(sanitiseForReflection(42), "42");
    assert.strictEqual(sanitiseForReflection(null), "null");
  });
});
