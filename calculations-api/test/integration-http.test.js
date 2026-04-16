// Integration test that starts a real HTTP server and makes actual network requests.
// Verifies the full stack: TCP listener, Express routing, JSON parsing, store persistence,
// and correct response shapes over real HTTP (not supertest's in-process shortcut).

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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "calc-integ-"));
  const { app } = makeApp({
    config: {
      port: 0, // OS-assigned port
      host: "127.0.0.1",
      dataFile: path.join(tmpDir, "data.json"),
      corsOrigin: "*",
      logRequests: false,
      maxExpressionLength: 200,
      maxTitleLength: 100,
      maxBodyBytes: 16384,
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

async function fetchJSON(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  const contentType = res.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await res.json() : null;
  return { status: res.status, headers: res.headers, body };
}

describe("real HTTP integration", () => {
  it("GET /health returns 200 with expected fields over real HTTP", async () => {
    const { status, body } = await fetchJSON("/health");
    assert.strictEqual(status, 200);
    assert.strictEqual(body.status, "ok");
    assert.strictEqual(body.service, "calculations-api");
    assert.strictEqual(typeof body.version, "string");
    assert.strictEqual(typeof body.uptimeSeconds, "number");
    assert.strictEqual(typeof body.timestamp, "string");
    // Verify timestamp is valid ISO-8601
    assert.ok(!isNaN(Date.parse(body.timestamp)), "timestamp should be valid ISO-8601");
  });

  it("full CRUD cycle over real HTTP", async () => {
    // POST - create
    const createRes = await fetchJSON("/calculations", {
      method: "POST",
      body: JSON.stringify({ expression: "7 * 8", title: "http test" }),
    });
    assert.strictEqual(createRes.status, 201);
    assert.strictEqual(createRes.body.result, 56);
    assert.strictEqual(createRes.body.title, "http test");
    assert.strictEqual(createRes.body.expression, "7 * 8");
    assert.ok(createRes.body.id);
    assert.ok(createRes.body.createdAt);
    assert.ok(createRes.body.updatedAt);

    const id = createRes.body.id;

    // GET single
    const getRes = await fetchJSON(`/calculations/${id}`);
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.id, id);
    assert.strictEqual(getRes.body.result, 56);

    // GET list
    const listRes = await fetchJSON("/calculations");
    assert.strictEqual(listRes.status, 200);
    assert.ok(listRes.body.items.length >= 1);
    assert.strictEqual(listRes.body.count, listRes.body.items.length);

    // PUT - update
    const putRes = await fetchJSON(`/calculations/${id}`, {
      method: "PUT",
      body: JSON.stringify({ expression: "100 / 4" }),
    });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.body.result, 25);
    assert.strictEqual(putRes.body.expression, "100 / 4");
    assert.strictEqual(putRes.body.title, "http test"); // title unchanged

    // DELETE
    const deleteRes = await fetch(`${baseUrl}/calculations/${id}`, {
      method: "DELETE",
    });
    assert.strictEqual(deleteRes.status, 204);

    // Verify deleted
    const goneRes = await fetchJSON(`/calculations/${id}`);
    assert.strictEqual(goneRes.status, 404);
    assert.strictEqual(goneRes.body.error.code, "NOT_FOUND");
  });

  it("returns proper error shape for validation failures over HTTP", async () => {
    const { status, body } = await fetchJSON("/calculations", {
      method: "POST",
      body: JSON.stringify({ expression: 999 }),
    });
    assert.strictEqual(status, 400);
    assert.strictEqual(body.error.code, "VALIDATION_ERROR");
    assert.match(body.error.message, /string/);
  });

  it("returns 404 for unknown routes over HTTP", async () => {
    const { status, body } = await fetchJSON("/nonexistent");
    assert.strictEqual(status, 404);
    assert.strictEqual(body.error.code, "ROUTE_NOT_FOUND");
  });

  it("includes CORS header in response", async () => {
    const { headers } = await fetchJSON("/health", {
      headers: { Origin: "http://example.com" },
    });
    assert.ok(headers.get("access-control-allow-origin"));
  });

  it("does not expose x-powered-by header", async () => {
    const { headers } = await fetchJSON("/health");
    assert.strictEqual(headers.get("x-powered-by"), null);
  });

  it("handles division by zero over HTTP", async () => {
    const { status, body } = await fetchJSON("/calculations", {
      method: "POST",
      body: JSON.stringify({ expression: "1/0" }),
    });
    assert.strictEqual(status, 422);
    assert.strictEqual(body.error.code, "EVALUATION_ERROR");
    assert.match(body.error.message, /division by zero/);
  });
});
