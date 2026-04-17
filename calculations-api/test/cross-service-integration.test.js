// Cross-service integration test that starts both calculations-api and notes-api
// as real HTTP servers and verifies they can run side-by-side, exercising full
// CRUD workflows, field name correctness, and concurrent request handling.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { makeApp as makeCalcApp } from "../src/app.js";

let calcServer, calcUrl;
let notesServer, notesUrl;
let tmpDir;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cross-svc-"));

  // Start calculations-api
  const { app: calcApp } = makeCalcApp({
    config: {
      port: 0,
      host: "127.0.0.1",
      dataFile: path.join(tmpDir, "calc-data.json"),
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
    calcServer = calcApp.listen(0, "127.0.0.1", () => {
      const addr = calcServer.address();
      calcUrl = `http://${addr.address}:${addr.port}`;
      resolve();
    });
  });

  // Start notes-api
  const { makeApp: makeNotesApp } = await import("../../notes-api/src/app.js");
  const { app: notesApp } = makeNotesApp({
    config: {
      port: 0,
      host: "127.0.0.1",
      dataFile: path.join(tmpDir, "notes-data.json"),
      corsOrigin: "*",
      logRequests: false,
      maxTitleLength: 200,
      maxContentLength: 10_000,
      maxBodyBytes: 65536,
      rateLimitWindowMs: 60_000,
      rateLimitMax: 1000,
    },
  });
  await new Promise((resolve) => {
    notesServer = notesApp.listen(0, "127.0.0.1", () => {
      const addr = notesServer.address();
      notesUrl = `http://${addr.address}:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  if (calcServer) await new Promise((r) => calcServer.close(r));
  if (notesServer) await new Promise((r) => notesServer.close(r));
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
});

async function fetchJSON(base, urlPath, options = {}) {
  const res = await fetch(`${base}${urlPath}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json() : null;
  return { status: res.status, headers: res.headers, body };
}

describe("cross-service integration", () => {
  it("both services respond to health checks simultaneously", async () => {
    const [calcHealth, notesHealth] = await Promise.all([
      fetchJSON(calcUrl, "/health"),
      fetchJSON(notesUrl, "/health"),
    ]);
    assert.strictEqual(calcHealth.status, 200);
    assert.strictEqual(calcHealth.body.service, "calculations-api");
    assert.strictEqual(notesHealth.status, 200);
    assert.strictEqual(notesHealth.body.service, "notes-api");
  });

  it("calculations use correct field names (expression, result, title)", async () => {
    const { body } = await fetchJSON(calcUrl, "/calculations", {
      method: "POST",
      body: JSON.stringify({ expression: "6 * 7", title: "The Answer" }),
    });
    assert.strictEqual(body.result, 42);
    assert.strictEqual(body.expression, "6 * 7");
    assert.strictEqual(body.title, "The Answer");
    // Verify NO wrong field names
    assert.strictEqual(body.formula, undefined);
    assert.strictEqual(body.text, undefined);
    assert.ok(body.id);
    assert.ok(body.createdAt);
    assert.ok(body.updatedAt);
  });

  it("notes use correct field names (title, content)", async () => {
    const { body } = await fetchJSON(notesUrl, "/notes", {
      method: "POST",
      body: JSON.stringify({ title: "Test Note", content: "some content" }),
    });
    assert.strictEqual(body.title, "Test Note");
    assert.strictEqual(body.content, "some content");
    // Verify NO wrong field names
    assert.strictEqual(body.text, undefined);
    assert.strictEqual(body.body, undefined);
    assert.ok(body.id);
    assert.ok(body.createdAt);
    assert.ok(body.updatedAt);
  });

  it("concurrent creates across both services succeed", async () => {
    const results = await Promise.all([
      fetchJSON(calcUrl, "/calculations", {
        method: "POST",
        body: JSON.stringify({ expression: "10 + 20" }),
      }),
      fetchJSON(calcUrl, "/calculations", {
        method: "POST",
        body: JSON.stringify({ expression: "30 + 40" }),
      }),
      fetchJSON(notesUrl, "/notes", {
        method: "POST",
        body: JSON.stringify({ title: "Concurrent 1", content: "a" }),
      }),
      fetchJSON(notesUrl, "/notes", {
        method: "POST",
        body: JSON.stringify({ title: "Concurrent 2", content: "b" }),
      }),
    ]);

    for (const r of results) {
      assert.strictEqual(r.status, 201);
      assert.ok(r.body.id);
    }

    // Verify all IDs are unique
    const ids = results.map((r) => r.body.id);
    assert.strictEqual(new Set(ids).size, 4);
  });

  it("list endpoints return correct response shape", async () => {
    const [calcList, notesList] = await Promise.all([
      fetchJSON(calcUrl, "/calculations"),
      fetchJSON(notesUrl, "/notes"),
    ]);

    // Both should have items, count, total
    assert.ok(Array.isArray(calcList.body.items));
    assert.strictEqual(typeof calcList.body.count, "number");
    assert.strictEqual(typeof calcList.body.total, "number");
    assert.strictEqual(calcList.body.count, calcList.body.items.length);

    assert.ok(Array.isArray(notesList.body.items));
    assert.strictEqual(typeof notesList.body.count, "number");
    assert.strictEqual(typeof notesList.body.total, "number");
    assert.strictEqual(notesList.body.count, notesList.body.items.length);
  });

  it("security headers are present on both services", async () => {
    const [calcRes, notesRes] = await Promise.all([
      fetchJSON(calcUrl, "/health"),
      fetchJSON(notesUrl, "/health"),
    ]);

    for (const res of [calcRes, notesRes]) {
      assert.ok(res.headers.get("x-content-type-options"));
      assert.ok(res.headers.get("x-frame-options"));
      assert.ok(res.headers.get("x-correlation-id"));
    }
  });

  it("both services enforce JSON content-type on mutations", async () => {
    const [calcRes, notesRes] = await Promise.all([
      fetch(`${calcUrl}/calculations`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "not json",
      }),
      fetch(`${notesUrl}/notes`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "not json",
      }),
    ]);

    assert.strictEqual(calcRes.status, 415);
    assert.strictEqual(notesRes.status, 415);
  });

  it("both services return 404 for non-existent resources", async () => {
    const fakeId = "00000000-0000-4000-a000-000000000000";
    const [calcRes, notesRes] = await Promise.all([
      fetchJSON(calcUrl, `/calculations/${fakeId}`),
      fetchJSON(notesUrl, `/notes/${fakeId}`),
    ]);

    assert.strictEqual(calcRes.status, 404);
    assert.strictEqual(calcRes.body.error.code, "NOT_FOUND");
    assert.strictEqual(notesRes.status, 404);
    assert.strictEqual(notesRes.body.error.code, "NOT_FOUND");
  });

  it("update and delete cycle works on both services", async () => {
    // Create on both
    const calc = await fetchJSON(calcUrl, "/calculations", {
      method: "POST",
      body: JSON.stringify({ expression: "99 + 1", title: "temp" }),
    });
    const note = await fetchJSON(notesUrl, "/notes", {
      method: "POST",
      body: JSON.stringify({ title: "temp note", content: "will delete" }),
    });

    // Update both
    const [calcUpdate, noteUpdate] = await Promise.all([
      fetchJSON(calcUrl, `/calculations/${calc.body.id}`, {
        method: "PUT",
        body: JSON.stringify({ title: "updated calc" }),
      }),
      fetchJSON(notesUrl, `/notes/${note.body.id}`, {
        method: "PUT",
        body: JSON.stringify({ title: "updated note" }),
      }),
    ]);
    assert.strictEqual(calcUpdate.body.title, "updated calc");
    assert.strictEqual(noteUpdate.body.title, "updated note");

    // Delete both
    const [calcDel, noteDel] = await Promise.all([
      fetch(`${calcUrl}/calculations/${calc.body.id}`, { method: "DELETE" }),
      fetch(`${notesUrl}/notes/${note.body.id}`, { method: "DELETE" }),
    ]);
    assert.strictEqual(calcDel.status, 204);
    assert.strictEqual(noteDel.status, 204);
  });
});
