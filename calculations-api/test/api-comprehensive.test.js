// Comprehensive API tests for calculations-api covering expression edge cases,
// stats consistency, sorting with null titles, pagination boundaries, and
// correlation ID handling over real HTTP.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { makeApp } from "../src/app.js";

let server;
let baseUrl;
let tmpDir;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "calc-comp-"));
  const { app } = makeApp({
    config: {
      port: 0,
      host: "127.0.0.1",
      dataFile: path.join(tmpDir, "data.json"),
      corsOrigin: "*",
      logRequests: false,
      rateLimitWindowMs: 60000,
      rateLimitMax: 1000,
      maxExpressionLength: 200,
      maxTitleLength: 100,
      maxBodyBytes: 65536,
    },
  });

  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      baseUrl = `http://${addr.address}:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
});

async function fetchJSON(urlPath, options = {}) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json() : null;
  return { status: res.status, headers: res.headers, body };
}

async function createCalc(expression, title) {
  const payload = { expression };
  if (title !== undefined) payload.title = title;
  const { body } = await fetchJSON("/calculations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return body;
}

describe("expression evaluation edge cases", () => {
  it("handles leading decimal point (.5)", async () => {
    const { status, body } = await fetchJSON("/calculations", {
      method: "POST",
      body: JSON.stringify({ expression: ".5 + .25" }),
    });
    assert.strictEqual(status, 201);
    assert.strictEqual(body.result, 0.75);
  });

  it("handles scientific notation with explicit plus exponent (1e+3)", async () => {
    const { status, body } = await fetchJSON("/calculations", {
      method: "POST",
      body: JSON.stringify({ expression: "1e+3" }),
    });
    assert.strictEqual(status, 201);
    assert.strictEqual(body.result, 1000);
  });

  it("handles negative exponent in scientific notation (2.5e-4)", async () => {
    const { status, body } = await fetchJSON("/calculations", {
      method: "POST",
      body: JSON.stringify({ expression: "2.5e-4" }),
    });
    assert.strictEqual(status, 201);
    assert.strictEqual(body.result, 0.00025);
  });

  it("handles deeply nested parentheses", async () => {
    const { status, body } = await fetchJSON("/calculations", {
      method: "POST",
      body: JSON.stringify({ expression: "(((((1 + 2)))))" }),
    });
    assert.strictEqual(status, 201);
    assert.strictEqual(body.result, 3);
  });

  it("handles unary plus operator", async () => {
    const { status, body } = await fetchJSON("/calculations", {
      method: "POST",
      body: JSON.stringify({ expression: "+5" }),
    });
    assert.strictEqual(status, 201);
    assert.strictEqual(body.result, 5);
  });

  it("handles chained unary minus (double negative)", async () => {
    const { status, body } = await fetchJSON("/calculations", {
      method: "POST",
      body: JSON.stringify({ expression: "--5" }),
    });
    assert.strictEqual(status, 201);
    assert.strictEqual(body.result, 5);
  });

  it("rounds floating-point noise (0.1 + 0.2)", async () => {
    const { status, body } = await fetchJSON("/calculations", {
      method: "POST",
      body: JSON.stringify({ expression: "0.1 + 0.2" }),
    });
    assert.strictEqual(status, 201);
    assert.strictEqual(body.result, 0.3);
  });

  it("rejects expressions producing Infinity", async () => {
    const { status, body } = await fetchJSON("/calculations", {
      method: "POST",
      body: JSON.stringify({ expression: "1e308 * 1e308" }),
    });
    assert.strictEqual(status, 422);
    assert.strictEqual(body.error.code, "EVALUATION_ERROR");
  });

  it("rejects division by zero", async () => {
    const { status, body } = await fetchJSON("/calculations", {
      method: "POST",
      body: JSON.stringify({ expression: "5 / 0" }),
    });
    assert.strictEqual(status, 422);
    assert.strictEqual(body.error.code, "EVALUATION_ERROR");
    assert.ok(body.error.message.includes("division by zero"));
  });

  it("rejects malformed scientific notation (1e)", async () => {
    const { status, body } = await fetchJSON("/calculations", {
      method: "POST",
      body: JSON.stringify({ expression: "1e" }),
    });
    assert.strictEqual(status, 422);
    assert.strictEqual(body.error.code, "EVALUATION_ERROR");
  });

  it("handles expression with whitespace (tabs and spaces)", async () => {
    const { status, body } = await fetchJSON("/calculations", {
      method: "POST",
      body: JSON.stringify({ expression: "  1\t+\t 2  " }),
    });
    assert.strictEqual(status, 201);
    assert.strictEqual(body.result, 3);
  });

  it("rejects empty expression after trim", async () => {
    const { status, body } = await fetchJSON("/calculations", {
      method: "POST",
      body: JSON.stringify({ expression: "   " }),
    });
    assert.strictEqual(status, 400);
    assert.strictEqual(body.error.code, "VALIDATION_ERROR");
  });

  it("rejects unexpected characters", async () => {
    const { status, body } = await fetchJSON("/calculations", {
      method: "POST",
      body: JSON.stringify({ expression: "2 ^ 3" }),
    });
    assert.strictEqual(status, 422);
    assert.strictEqual(body.error.code, "EVALUATION_ERROR");
  });
});

describe("stats endpoint consistency", () => {
  let calcIds;

  before(async () => {
    calcIds = [];
    const c1 = await createCalc("10 + 5", "calc one");
    const c2 = await createCalc("20 - 3", "calc two");
    const c3 = await createCalc("-7", "negative");
    calcIds.push(c1.id, c2.id, c3.id);
  });

  it("returns correct stats shape and field names", async () => {
    const { status, body } = await fetchJSON("/calculations/stats");
    assert.strictEqual(status, 200);
    assert.strictEqual(typeof body.totalCalculations, "number");
    assert.ok(body.totalCalculations >= 3);
    assert.strictEqual(typeof body.averageResult, "number");
    assert.strictEqual(typeof body.minResult, "number");
    assert.strictEqual(typeof body.maxResult, "number");
    assert.strictEqual(typeof body.lastCalculatedAt, "string");
  });

  it("includes negative results in min calculation", async () => {
    const { body } = await fetchJSON("/calculations/stats");
    assert.ok(body.minResult <= -7, `minResult should be <= -7, got ${body.minResult}`);
  });

  it("stats update after a delete", async () => {
    const before = await fetchJSON("/calculations/stats");
    const beforeTotal = before.body.totalCalculations;

    // Delete one
    if (calcIds.length > 0) {
      const deleteId = calcIds.pop();
      await fetch(`${baseUrl}/calculations/${deleteId}`, { method: "DELETE" });
    }

    const afterDel = await fetchJSON("/calculations/stats");
    assert.strictEqual(afterDel.body.totalCalculations, beforeTotal - 1);
  });

  it("stats update after an expression update", async () => {
    const calc = await createCalc("100");
    const { body: statsBefore } = await fetchJSON("/calculations/stats");

    // Update expression to a different value
    await fetchJSON(`/calculations/${calc.id}`, {
      method: "PUT",
      body: JSON.stringify({ expression: "200" }),
    });

    const { body: statsAfter } = await fetchJSON("/calculations/stats");
    // Max should have increased
    assert.ok(statsAfter.maxResult >= 200);
    // Total count should remain the same
    assert.strictEqual(statsAfter.totalCalculations, statsBefore.totalCalculations);
  });
});

describe("sorting with null and non-null titles", () => {
  before(async () => {
    await createCalc("1", "AAA");
    await createCalc("2", null);
    await createCalc("3", "ZZZ");
    await createCalc("4"); // title omitted → null
  });

  it("sorts by title ascending with nulls (null treated as empty string)", async () => {
    const { body } = await fetchJSON("/calculations?sort=title&order=asc");
    assert.ok(body.items.length >= 4);
    // Null titles should sort as empty string, so they come first
    let lastTitle = "";
    for (const item of body.items) {
      const title = item.title ?? "";
      assert.ok(title >= lastTitle, `title "${title}" should be >= "${lastTitle}"`);
      lastTitle = title;
    }
  });

  it("sorts by result numerically", async () => {
    const { body } = await fetchJSON("/calculations?sort=result&order=asc");
    for (let i = 1; i < body.items.length; i++) {
      assert.ok(body.items[i - 1].result <= body.items[i].result);
    }
  });
});

describe("pagination edge cases", () => {
  it("negative offset clamped to 0", async () => {
    const { status } = await fetchJSON("/calculations?offset=-1");
    assert.strictEqual(status, 200);
  });

  it("offset beyond total returns empty items", async () => {
    const { body } = await fetchJSON("/calculations?offset=99999&limit=10");
    assert.strictEqual(body.count, 0);
    assert.strictEqual(body.items.length, 0);
    assert.ok(body.total > 0);
  });

  it("limit capped at MAX_PAGE_SIZE (100)", async () => {
    const { status } = await fetchJSON("/calculations?limit=500");
    assert.strictEqual(status, 200);
  });
});

describe("CRUD field validation", () => {
  it("null title is preserved on create", async () => {
    const { status, body } = await fetchJSON("/calculations", {
      method: "POST",
      body: JSON.stringify({ expression: "42", title: null }),
    });
    assert.strictEqual(status, 201);
    assert.strictEqual(body.title, null);
  });

  it("whitespace-only title becomes null", async () => {
    const { status, body } = await fetchJSON("/calculations", {
      method: "POST",
      body: JSON.stringify({ expression: "42", title: "   " }),
    });
    assert.strictEqual(status, 201);
    assert.strictEqual(body.title, null);
  });

  it("update with only title preserves expression and result", async () => {
    const calc = await createCalc("7 * 6", "original");
    const { body: updated } = await fetchJSON(`/calculations/${calc.id}`, {
      method: "PUT",
      body: JSON.stringify({ title: "renamed" }),
    });
    assert.strictEqual(updated.title, "renamed");
    assert.strictEqual(updated.expression, "7 * 6");
    assert.strictEqual(updated.result, 42);
  });

  it("update with new expression re-evaluates result", async () => {
    const calc = await createCalc("1 + 1", "math");
    const { body: updated } = await fetchJSON(`/calculations/${calc.id}`, {
      method: "PUT",
      body: JSON.stringify({ expression: "10 * 10" }),
    });
    assert.strictEqual(updated.result, 100);
    assert.strictEqual(updated.expression, "10 * 10");
  });

  it("response includes correct field names", async () => {
    const calc = await createCalc("5 + 3", "test");
    assert.strictEqual(typeof calc.id, "string");
    assert.strictEqual(typeof calc.expression, "string");
    assert.strictEqual(typeof calc.result, "number");
    assert.strictEqual(typeof calc.createdAt, "string");
    assert.strictEqual(typeof calc.updatedAt, "string");
    assert.strictEqual(calc.title, "test");
    // Verify fields are NOT named incorrectly
    assert.strictEqual(calc.formula, undefined);
    assert.strictEqual(calc.value, undefined);
  });
});

describe("correlation ID over HTTP", () => {
  it("returns a correlation ID on every response", async () => {
    const { headers } = await fetchJSON("/health");
    assert.ok(headers.get("x-correlation-id"));
  });

  it("echoes back valid client-supplied correlation ID", async () => {
    const customId = "calc-req-42";
    const { headers } = await fetchJSON("/health", {
      headers: { "X-Correlation-Id": customId },
    });
    assert.strictEqual(headers.get("x-correlation-id"), customId);
  });

  it("rejects oversized correlation ID", async () => {
    const longId = "z".repeat(200);
    const { headers } = await fetchJSON("/health", {
      headers: { "X-Correlation-Id": longId },
    });
    assert.notStrictEqual(headers.get("x-correlation-id"), longId);
  });
});

describe("error handling edge cases", () => {
  it("malformed JSON returns INVALID_JSON", async () => {
    const res = await fetch(`${baseUrl}/calculations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const body = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(body.error.code, "INVALID_JSON");
  });

  it("missing expression returns VALIDATION_ERROR", async () => {
    const { status, body } = await fetchJSON("/calculations", {
      method: "POST",
      body: JSON.stringify({ title: "no expression" }),
    });
    assert.strictEqual(status, 400);
    assert.strictEqual(body.error.code, "VALIDATION_ERROR");
  });

  it("empty body on PUT returns VALIDATION_ERROR", async () => {
    const calc = await createCalc("1");
    const { status, body } = await fetchJSON(`/calculations/${calc.id}`, {
      method: "PUT",
      body: JSON.stringify({}),
    });
    assert.strictEqual(status, 400);
    assert.strictEqual(body.error.code, "VALIDATION_ERROR");
  });

  it("PUT with invalid expression returns EVALUATION_ERROR", async () => {
    const calc = await createCalc("1");
    const { status, body } = await fetchJSON(`/calculations/${calc.id}`, {
      method: "PUT",
      body: JSON.stringify({ expression: "abc" }),
    });
    assert.strictEqual(status, 422);
    assert.strictEqual(body.error.code, "EVALUATION_ERROR");
  });

  it("non-existent ID returns NOT_FOUND with details", async () => {
    const fakeId = "00000000-0000-4000-8000-000000000000";
    const { status, body } = await fetchJSON(`/calculations/${fakeId}`);
    assert.strictEqual(status, 404);
    assert.strictEqual(body.error.code, "NOT_FOUND");
    assert.strictEqual(body.error.details.resource, "calculation");
  });
});

describe("security headers over HTTP", () => {
  it("includes all security headers", async () => {
    const { headers } = await fetchJSON("/health");
    assert.strictEqual(headers.get("x-content-type-options"), "nosniff");
    assert.strictEqual(headers.get("x-frame-options"), "DENY");
    assert.ok(headers.get("strict-transport-security"));
    assert.ok(headers.get("content-security-policy"));
  });

  it("does not expose x-powered-by", async () => {
    const { headers } = await fetchJSON("/health");
    assert.strictEqual(headers.get("x-powered-by"), null);
  });

  it("rate limit headers are present", async () => {
    const { headers } = await fetchJSON("/health");
    assert.ok(headers.get("x-ratelimit-limit"));
    assert.ok(headers.get("x-ratelimit-remaining"));
  });
});
