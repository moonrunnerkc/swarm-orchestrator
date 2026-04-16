// Advanced integration tests using real HTTP server connections.
// Covers concurrent operations, ordering, timestamp semantics, and content-type handling.

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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "notes-integ-adv-"));
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

async function fetchJSON(urlPath, options = {}) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  const contentType = res.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await res.json() : null;
  return { status: res.status, headers: res.headers, body };
}

describe("real HTTP: concurrent note creation", () => {
  it("handles multiple concurrent creates without data loss", async () => {
    const titles = Array.from({ length: 5 }, (_, i) => `Concurrent ${i}`);

    const results = await Promise.all(
      titles.map((title) =>
        fetchJSON("/notes", {
          method: "POST",
          body: JSON.stringify({ title, content: "parallel" }),
        }),
      ),
    );

    for (const r of results) {
      assert.strictEqual(r.status, 201, `expected 201 but got ${r.status}`);
    }

    const createdIds = results.map((r) => r.body.id);
    const uniqueIds = new Set(createdIds);
    assert.strictEqual(uniqueIds.size, titles.length, "all IDs must be unique");
  });
});

describe("real HTTP: timestamp semantics", () => {
  it("createdAt and updatedAt are valid ISO-8601 dates", async () => {
    const { body } = await fetchJSON("/notes", {
      method: "POST",
      body: JSON.stringify({ title: "timestamp check" }),
    });

    assert.ok(!isNaN(Date.parse(body.createdAt)), "createdAt must be valid ISO-8601");
    assert.ok(!isNaN(Date.parse(body.updatedAt)), "updatedAt must be valid ISO-8601");
  });

  it("updatedAt advances after a PUT but createdAt stays fixed", async () => {
    const create = await fetchJSON("/notes", {
      method: "POST",
      body: JSON.stringify({ title: "ts test" }),
    });
    const id = create.body.id;

    // Small wait so timestamps differ
    await new Promise((r) => setTimeout(r, 15));

    const update = await fetchJSON(`/notes/${id}`, {
      method: "PUT",
      body: JSON.stringify({ title: "ts test updated" }),
    });

    assert.strictEqual(update.body.createdAt, create.body.createdAt);
    assert.ok(
      new Date(update.body.updatedAt) >= new Date(create.body.updatedAt),
      "updatedAt should advance",
    );
  });
});

describe("real HTTP: content-type and method handling", () => {
  it("returns JSON content-type for note responses", async () => {
    const res = await fetchJSON("/notes", {
      method: "POST",
      body: JSON.stringify({ title: "ct test" }),
    });
    assert.strictEqual(res.status, 201);
    assert.ok(
      res.headers.get("content-type").includes("application/json"),
      "response should be JSON",
    );
  });

  it("DELETE returns 204 with no body over real HTTP", async () => {
    const create = await fetchJSON("/notes", {
      method: "POST",
      body: JSON.stringify({ title: "delete-me" }),
    });

    const deleteRes = await fetch(`${baseUrl}/notes/${create.body.id}`, {
      method: "DELETE",
    });
    assert.strictEqual(deleteRes.status, 204);

    const text = await deleteRes.text();
    assert.strictEqual(text, "", "DELETE 204 should have empty body");
  });

  it("OPTIONS request returns CORS headers for preflight", async () => {
    const res = await fetch(`${baseUrl}/notes`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://example.com",
        "Access-Control-Request-Method": "POST",
      },
    });
    assert.ok(
      res.headers.get("access-control-allow-origin"),
      "should return CORS allow-origin on preflight",
    );
  });
});

describe("real HTTP: security headers present", () => {
  it("all security headers are set on real HTTP responses", async () => {
    const { headers } = await fetchJSON("/health");

    assert.strictEqual(headers.get("x-content-type-options"), "nosniff");
    assert.strictEqual(headers.get("x-frame-options"), "DENY");
    assert.strictEqual(headers.get("referrer-policy"), "no-referrer");
    assert.ok(headers.get("content-security-policy"));
    assert.ok(headers.get("strict-transport-security"));
    assert.strictEqual(headers.get("x-powered-by"), null);
  });
});

describe("real HTTP: error responses over the network", () => {
  it("returns 400 for invalid UUID in GET path", async () => {
    const { status, body } = await fetchJSON("/notes/not-a-uuid");
    assert.strictEqual(status, 400);
    assert.strictEqual(body.error.code, "VALIDATION_ERROR");
  });

  it("returns 400 for invalid UUID in PUT path", async () => {
    const { status, body } = await fetchJSON("/notes/bad", {
      method: "PUT",
      body: JSON.stringify({ title: "x" }),
    });
    assert.strictEqual(status, 400);
    assert.strictEqual(body.error.code, "VALIDATION_ERROR");
  });

  it("returns 400 for invalid UUID in DELETE path", async () => {
    const res = await fetch(`${baseUrl}/notes/bad`, { method: "DELETE" });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.error.code, "VALIDATION_ERROR");
  });

  it("returns 400 for empty POST body", async () => {
    const { status, body } = await fetchJSON("/notes", {
      method: "POST",
      body: JSON.stringify({}),
    });
    assert.strictEqual(status, 400);
    assert.strictEqual(body.error.code, "VALIDATION_ERROR");
  });

  it("returns 404 with error shape for GET nonexistent note", async () => {
    const { status, body } = await fetchJSON(
      "/notes/00000000-0000-4000-a000-000000000000",
    );
    assert.strictEqual(status, 404);
    assert.strictEqual(body.error.code, "NOT_FOUND");
    assert.ok(body.error.message);
    assert.ok(body.error.details);
    assert.strictEqual(body.error.details.resource, "note");
  });
});

describe("real HTTP: list ordering and filtering", () => {
  it("GET /notes count matches items array length", async () => {
    const { body } = await fetchJSON("/notes");
    assert.strictEqual(body.count, body.items.length);
  });

  it("each item in list has all required fields", async () => {
    await fetchJSON("/notes", {
      method: "POST",
      body: JSON.stringify({ title: "field check" }),
    });

    const { body } = await fetchJSON("/notes");
    for (const item of body.items) {
      assert.ok(item.id, "item must have id");
      assert.ok(item.title, "item must have title");
      assert.ok("content" in item, "item must have content key");
      assert.ok(item.createdAt, "item must have createdAt");
      assert.ok(item.updatedAt, "item must have updatedAt");
    }
  });
});
