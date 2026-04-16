// Integration test that starts a real HTTP server and makes actual network requests.

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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "notes-integ-"));
  const { app } = makeApp({
    config: {
      port: 0,
      host: "127.0.0.1",
      dataFile: path.join(tmpDir, "data.json"),
      corsOrigin: "*",
      logRequests: false,
      maxTitleLength: 200,
      maxContentLength: 10_000,
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
    assert.strictEqual(body.service, "notes-api");
    assert.strictEqual(typeof body.version, "string");
    assert.strictEqual(typeof body.uptimeSeconds, "number");
    assert.strictEqual(typeof body.timestamp, "string");
    assert.ok(!isNaN(Date.parse(body.timestamp)), "timestamp should be valid ISO-8601");
  });

  it("full CRUD cycle over real HTTP", async () => {
    // POST - create
    const createRes = await fetchJSON("/notes", {
      method: "POST",
      body: JSON.stringify({ title: "HTTP note", content: "created over HTTP" }),
    });
    assert.strictEqual(createRes.status, 201);
    assert.strictEqual(createRes.body.title, "HTTP note");
    assert.strictEqual(createRes.body.content, "created over HTTP");
    assert.ok(createRes.body.id);
    assert.ok(createRes.body.createdAt);
    assert.ok(createRes.body.updatedAt);

    const id = createRes.body.id;

    // GET single
    const getRes = await fetchJSON(`/notes/${id}`);
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.id, id);
    assert.strictEqual(getRes.body.title, "HTTP note");

    // GET list
    const listRes = await fetchJSON("/notes");
    assert.strictEqual(listRes.status, 200);
    assert.ok(listRes.body.items.length >= 1);
    assert.strictEqual(listRes.body.count, listRes.body.items.length);

    // PUT - update
    const putRes = await fetchJSON(`/notes/${id}`, {
      method: "PUT",
      body: JSON.stringify({ title: "Updated HTTP note" }),
    });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.body.title, "Updated HTTP note");
    assert.strictEqual(putRes.body.content, "created over HTTP"); // content unchanged

    // DELETE
    const deleteRes = await fetch(`${baseUrl}/notes/${id}`, {
      method: "DELETE",
    });
    assert.strictEqual(deleteRes.status, 204);

    // Verify deleted
    const goneRes = await fetchJSON(`/notes/${id}`);
    assert.strictEqual(goneRes.status, 404);
    assert.strictEqual(goneRes.body.error.code, "NOT_FOUND");
  });

  it("returns proper error shape for validation failures over HTTP", async () => {
    const { status, body } = await fetchJSON("/notes", {
      method: "POST",
      body: JSON.stringify({ title: 999 }),
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
});
