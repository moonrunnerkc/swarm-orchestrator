// Tests for uncovered branches in calculations-api source code.
// Covers: logRequests config, store malformed data & clear(), pagination
// edge cases, sort equality, stats error path, and evaluate edge cases.

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { makeApp } from "../src/app.js";
import { createStore } from "../src/store.js";
import { evaluateExpression } from "../src/evaluate.js";
import { sanitiseForReflection } from "../src/security.js";

// --- Store: malformed data file and clear() ---

describe("store edge cases", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "calc-store-gap-"));
  });

  after(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("throws on malformed data file (missing items array)", async () => {
    const dataFile = path.join(tmpDir, "bad.json");
    await fs.writeFile(dataFile, JSON.stringify({ schemaVersion: 1 }));
    const store = createStore({ dataFile });
    await assert.rejects(() => store.list(), /malformed/);
  });

  it("throws on invalid JSON in data file", async () => {
    const dataFile = path.join(tmpDir, "invalid.json");
    await fs.writeFile(dataFile, "not json at all {{{");
    const store = createStore({ dataFile });
    await assert.rejects(() => store.list());
  });

  it("clear() removes all items", async () => {
    const dataFile = path.join(tmpDir, "cleartest.json");
    const store = createStore({ dataFile, now: () => "2024-01-01T00:00:00Z" });
    await store.create({ title: "a", expression: "1+1", result: 2 });
    await store.create({ title: "b", expression: "2+2", result: 4 });
    let items = await store.list();
    assert.strictEqual(items.length, 2);

    await store.clear();
    items = await store.list();
    assert.strictEqual(items.length, 0);
  });

  it("update returns null for non-existent id", async () => {
    const dataFile = path.join(tmpDir, "update-missing.json");
    const store = createStore({ dataFile });
    const result = await store.update("non-existent-id", { title: "x" });
    assert.strictEqual(result, null);
  });

  it("remove returns false for non-existent id", async () => {
    const dataFile = path.join(tmpDir, "remove-missing.json");
    const store = createStore({ dataFile });
    const result = await store.remove("non-existent-id");
    assert.strictEqual(result, false);
  });
});

// --- Evaluate: edge cases for uncovered branches ---

describe("evaluate edge cases", () => {
  it("rejects expression that produces non-finite result", () => {
    // 1e308 * 10 overflows to Infinity (within maxLength)
    assert.throws(
      () => evaluateExpression("1e308 * 1e308"),
      /not a finite number/,
    );
  });

  it("rejects malformed scientific notation (missing exponent digits)", () => {
    assert.throws(
      () => evaluateExpression("1e"),
      /malformed number/,
    );
  });

  it("rejects trailing tokens after valid expression", () => {
    assert.throws(
      () => evaluateExpression("1 + 2 )"),
      /unexpected trailing token/,
    );
  });

  it("rejects unexpected token in primary position", () => {
    assert.throws(
      () => evaluateExpression("* 5"),
      /unexpected/,
    );
  });

  it("handles unary plus and minus", () => {
    const pos = evaluateExpression("+5");
    assert.strictEqual(pos.result, 5);
    const neg = evaluateExpression("-5");
    assert.strictEqual(neg.result, -5);
  });

  it("handles nested parentheses", () => {
    const r = evaluateExpression("((2 + 3) * (4 - 1))");
    assert.strictEqual(r.result, 15);
  });

  it("handles scientific notation with positive exponent", () => {
    const r = evaluateExpression("2.5e+2");
    assert.strictEqual(r.result, 250);
  });

  it("handles scientific notation with negative exponent", () => {
    const r = evaluateExpression("5e-3");
    assert.strictEqual(r.result, 0.005);
  });
});

// --- sanitiseForReflection edge cases ---

describe("sanitiseForReflection", () => {
  it("truncates strings longer than 200 chars", () => {
    const long = "a".repeat(300);
    const result = sanitiseForReflection(long);
    assert.strictEqual(result.length, 203); // 200 + "..."
    assert.ok(result.endsWith("..."));
  });

  it("converts non-string values to string", () => {
    assert.strictEqual(sanitiseForReflection(42), "42");
    assert.strictEqual(sanitiseForReflection(null), "null");
  });

  it("strips control characters", () => {
    const result = sanitiseForReflection("hello\x00world\x1f!");
    assert.strictEqual(result, "helloworld!");
  });
});

// --- App with logRequests enabled ---

describe("app with logRequests enabled", () => {
  let server, baseUrl, tmpDir;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "calc-log-"));
    const { app } = makeApp({
      config: {
        port: 0,
        host: "127.0.0.1",
        dataFile: path.join(tmpDir, "data.json"),
        corsOrigin: "*",
        logRequests: true, // exercises the uncovered branch
        maxExpressionLength: 200,
        maxTitleLength: 100,
        maxBodyBytes: 16384,
        rateLimitWindowMs: 60_000,
        rateLimitMax: 1000,
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

  it("serves requests normally with logging enabled", async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, "ok");
  });
});

// --- Pagination and sorting edge cases over HTTP ---

describe("pagination and sorting edge cases", () => {
  let server, baseUrl, tmpDir;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "calc-page-"));
    const { app } = makeApp({
      config: {
        port: 0,
        host: "127.0.0.1",
        dataFile: path.join(tmpDir, "data.json"),
        corsOrigin: "*",
        logRequests: false,
        maxExpressionLength: 200,
        maxTitleLength: 100,
        maxBodyBytes: 16384,
        rateLimitWindowMs: 60_000,
        rateLimitMax: 1000,
      },
    });

    await new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        baseUrl = `http://${addr.address}:${addr.port}`;
        resolve();
      });
    });

    // Seed three calculations
    for (const expr of ["1+1", "2+2", "3+3"]) {
      await fetch(`${baseUrl}/calculations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expression: expr }),
      });
    }
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("supports limit parameter", async () => {
    const res = await fetch(`${baseUrl}/calculations?limit=2`);
    const body = await res.json();
    assert.strictEqual(body.count, 2);
    assert.strictEqual(body.total, 3);
  });

  it("supports offset parameter without limit", async () => {
    const res = await fetch(`${baseUrl}/calculations?offset=1`);
    const body = await res.json();
    assert.strictEqual(body.count, 2);
    assert.strictEqual(body.total, 3);
  });

  it("supports limit and offset together", async () => {
    const res = await fetch(`${baseUrl}/calculations?limit=1&offset=1`);
    const body = await res.json();
    assert.strictEqual(body.count, 1);
    assert.strictEqual(body.total, 3);
  });

  it("sorts by result ascending", async () => {
    const res = await fetch(`${baseUrl}/calculations?sort=result&order=asc`);
    const body = await res.json();
    assert.ok(body.items[0].result <= body.items[1].result);
  });

  it("sorts by createdAt ascending", async () => {
    const res = await fetch(`${baseUrl}/calculations?sort=createdAt&order=asc`);
    const body = await res.json();
    assert.ok(body.items[0].createdAt <= body.items[1].createdAt);
  });

  it("falls back to updatedAt when sort field is invalid", async () => {
    const res = await fetch(`${baseUrl}/calculations?sort=invalid_field`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.items.length, 3);
  });

  it("handles offset beyond total items", async () => {
    const res = await fetch(`${baseUrl}/calculations?offset=100`);
    const body = await res.json();
    assert.strictEqual(body.count, 0);
    assert.strictEqual(body.total, 3);
  });
});

// --- Stats endpoint edge cases ---

describe("stats endpoint", () => {
  let server, baseUrl, tmpDir;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "calc-stats-"));
    const { app } = makeApp({
      config: {
        port: 0,
        host: "127.0.0.1",
        dataFile: path.join(tmpDir, "data.json"),
        corsOrigin: "*",
        logRequests: false,
        maxExpressionLength: 200,
        maxTitleLength: 100,
        maxBodyBytes: 16384,
        rateLimitWindowMs: 60_000,
        rateLimitMax: 1000,
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

  it("returns null stats when no calculations exist", async () => {
    const res = await fetch(`${baseUrl}/calculations/stats`);
    const body = await res.json();
    assert.strictEqual(body.totalCalculations, 0);
    assert.strictEqual(body.averageResult, null);
    assert.strictEqual(body.minResult, null);
    assert.strictEqual(body.maxResult, null);
    assert.strictEqual(body.lastCalculatedAt, null);
  });

  it("returns correct stats with negative results", async () => {
    await fetch(`${baseUrl}/calculations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expression: "0 - 10" }),
    });
    await fetch(`${baseUrl}/calculations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expression: "20 + 0" }),
    });

    const res = await fetch(`${baseUrl}/calculations/stats`);
    const body = await res.json();
    assert.strictEqual(body.totalCalculations, 2);
    assert.strictEqual(body.minResult, -10);
    assert.strictEqual(body.maxResult, 20);
    assert.strictEqual(body.averageResult, 5);
    assert.ok(body.lastCalculatedAt);
  });
});
