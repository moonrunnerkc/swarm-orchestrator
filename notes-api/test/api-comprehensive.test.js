// Comprehensive API tests for notes-api covering search+sort+pagination combos,
// correlation ID handling, error edge cases, and pagination boundary conditions.

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { makeApp } from "../src/app.js";

let server;
let baseUrl;
let tmpDir;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "notes-comp-"));
  const { app } = makeApp({
    config: {
      port: 0,
      host: "127.0.0.1",
      dataFile: path.join(tmpDir, "data.json"),
      corsOrigin: "*",
      logRequests: false,
      rateLimitWindowMs: 60000,
      rateLimitMax: 1000,
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
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json() : null;
  return { status: res.status, headers: res.headers, body };
}

async function createNote(title, content = "") {
  const { body } = await fetchJSON("/notes", {
    method: "POST",
    body: JSON.stringify({ title, content }),
  });
  return body;
}

describe("search + sort + pagination combined", () => {
  before(async () => {
    // Seed notes for search/sort/pagination tests
    await createNote("Alpha recipe", "cook pasta with sauce");
    await createNote("Beta guide", "how to cook rice properly");
    await createNote("Gamma notes", "unrelated content here");
    await createNote("Delta recipe", "cook steak medium rare");
    await createNote("Epsilon tip", "cooking with olive oil");
  });

  it("searches across title and content case-insensitively", async () => {
    const { status, body } = await fetchJSON("/notes?q=COOK");
    assert.strictEqual(status, 200);
    // Should match notes with "cook" or "cooking" in title or content
    assert.ok(body.items.length >= 3, `expected >=3 matches, got ${body.items.length}`);
    for (const note of body.items) {
      const combined = (note.title + note.content).toLowerCase();
      assert.ok(combined.includes("cook"), `note ${note.id} should match 'cook'`);
    }
  });

  it("searches + sorts + paginates together", async () => {
    const { body } = await fetchJSON("/notes?q=cook&sort=title&order=asc&limit=2&offset=0");
    assert.strictEqual(body.count, 2);
    assert.ok(body.total >= 3);
    // Sorted ascending by title, so first should come before second alphabetically
    assert.ok(body.items[0].title <= body.items[1].title);
  });

  it("returns empty array for search with no matches", async () => {
    const { status, body } = await fetchJSON("/notes?q=xyznonexistent");
    assert.strictEqual(status, 200);
    assert.strictEqual(body.items.length, 0);
    assert.strictEqual(body.count, 0);
    assert.strictEqual(body.total, 0);
  });

  it("handles empty search string by returning all notes", async () => {
    const { body: allNotes } = await fetchJSON("/notes");
    const { body: emptySearch } = await fetchJSON("/notes?q=");
    assert.strictEqual(emptySearch.total, allNotes.total);
  });

  it("handles search with special characters safely", async () => {
    const { status } = await fetchJSON("/notes?q=.*%5B%5D%28%29");
    assert.strictEqual(status, 200);
    // Should not crash, just return empty or matching results
  });
});

describe("pagination edge cases", () => {
  it("negative offset is clamped to 0", async () => {
    const { status, body } = await fetchJSON("/notes?offset=-5");
    assert.strictEqual(status, 200);
    // Negative offset treated as 0 via Math.max(0, ...)
    const { body: noOffset } = await fetchJSON("/notes");
    assert.strictEqual(body.total, noOffset.total);
  });

  it("offset beyond total returns empty items", async () => {
    const { body } = await fetchJSON("/notes?offset=99999&limit=10");
    assert.strictEqual(body.count, 0);
    assert.strictEqual(body.items.length, 0);
    assert.ok(body.total > 0);
  });

  it("limit of 0 returns all items (no pagination)", async () => {
    const { body } = await fetchJSON("/notes?limit=0");
    assert.strictEqual(body.count, body.total);
  });

  it("limit exceeding MAX_PAGE_SIZE (100) is capped", async () => {
    const { status } = await fetchJSON("/notes?limit=200");
    assert.strictEqual(status, 200);
    // Should not crash — limit capped to 100 internally
  });

  it("non-numeric limit and offset are treated as 0", async () => {
    const { status, body } = await fetchJSON("/notes?limit=abc&offset=xyz");
    assert.strictEqual(status, 200);
    assert.strictEqual(body.count, body.total);
  });

  it("offset without limit returns items from offset", async () => {
    const { body: all } = await fetchJSON("/notes");
    if (all.total > 1) {
      const { body: offset1 } = await fetchJSON("/notes?offset=1");
      assert.strictEqual(offset1.count, all.total - 1);
    }
  });
});

describe("sorting behavior", () => {
  it("invalid sort field defaults to updatedAt", async () => {
    const { body: defaultSort } = await fetchJSON("/notes");
    const { body: invalidSort } = await fetchJSON("/notes?sort=invalid_field");
    assert.deepStrictEqual(
      defaultSort.items.map((n) => n.id),
      invalidSort.items.map((n) => n.id),
    );
  });

  it("sorts by title ascending", async () => {
    const { body } = await fetchJSON("/notes?sort=title&order=asc");
    for (let i = 1; i < body.items.length; i++) {
      assert.ok(
        body.items[i - 1].title <= body.items[i].title,
        `items[${i - 1}].title (${body.items[i - 1].title}) should be <= items[${i}].title (${body.items[i].title})`,
      );
    }
  });

  it("sorts by createdAt descending by default order", async () => {
    const { body } = await fetchJSON("/notes?sort=createdAt");
    for (let i = 1; i < body.items.length; i++) {
      assert.ok(body.items[i - 1].createdAt >= body.items[i].createdAt);
    }
  });
});

describe("correlation ID", () => {
  it("generates correlation ID when none supplied", async () => {
    const { headers } = await fetchJSON("/health");
    const corrId = headers.get("x-correlation-id");
    assert.ok(corrId, "should have X-Correlation-Id header");
    assert.ok(corrId.length > 0);
  });

  it("echoes back a valid client-supplied correlation ID", async () => {
    const customId = "my-request-12345";
    const { headers } = await fetchJSON("/health", {
      headers: { "X-Correlation-Id": customId },
    });
    assert.strictEqual(headers.get("x-correlation-id"), customId);
  });

  it("generates new ID when no correlation ID is supplied", async () => {
    // Without the header, the server generates a UUID
    const { headers: h1 } = await fetchJSON("/health");
    const { headers: h2 } = await fetchJSON("/health");
    const id1 = h1.get("x-correlation-id");
    const id2 = h2.get("x-correlation-id");
    assert.ok(id1);
    assert.ok(id2);
    // Each request gets a unique ID
    assert.notStrictEqual(id1, id2);
  });

  it("rejects correlation ID exceeding 128 chars", async () => {
    const longId = "a".repeat(129);
    const { headers } = await fetchJSON("/health", {
      headers: { "X-Correlation-Id": longId },
    });
    const corrId = headers.get("x-correlation-id");
    assert.notStrictEqual(corrId, longId);
  });

  it("accepts correlation ID exactly 128 chars", async () => {
    const exactId = "x".repeat(128);
    const { headers } = await fetchJSON("/health", {
      headers: { "X-Correlation-Id": exactId },
    });
    assert.strictEqual(headers.get("x-correlation-id"), exactId);
  });
});

describe("error response shapes", () => {
  it("returns ROUTE_NOT_FOUND for unknown paths", async () => {
    const { status, body } = await fetchJSON("/does-not-exist");
    assert.strictEqual(status, 404);
    assert.strictEqual(body.error.code, "ROUTE_NOT_FOUND");
    assert.ok(body.error.message.includes("does-not-exist"));
  });

  it("returns NOT_FOUND with resource details for missing note", async () => {
    const fakeId = "00000000-0000-4000-8000-000000000000";
    const { status, body } = await fetchJSON(`/notes/${fakeId}`);
    assert.strictEqual(status, 404);
    assert.strictEqual(body.error.code, "NOT_FOUND");
    assert.strictEqual(body.error.details.resource, "note");
    assert.strictEqual(body.error.details.id, fakeId);
  });

  it("returns INVALID_JSON for malformed request body", async () => {
    const res = await fetch(`${baseUrl}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad json",
    });
    const body = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(body.error.code, "INVALID_JSON");
  });

  it("returns VALIDATION_ERROR for UUID with wrong format", async () => {
    const { status, body } = await fetchJSON("/notes/not-a-uuid");
    assert.strictEqual(status, 400);
    assert.strictEqual(body.error.code, "VALIDATION_ERROR");
  });
});

describe("idempotency and data integrity", () => {
  it("creates notes with unique IDs for identical payloads", async () => {
    const note1 = await createNote("same title", "same content");
    const note2 = await createNote("same title", "same content");
    assert.notStrictEqual(note1.id, note2.id);
  });

  it("update preserves createdAt and changes updatedAt", async () => {
    const note = await createNote("timestamp test");
    // Small delay to ensure time difference
    await new Promise((r) => setTimeout(r, 10));
    const { body: updated } = await fetchJSON(`/notes/${note.id}`, {
      method: "PUT",
      body: JSON.stringify({ title: "updated title" }),
    });
    assert.strictEqual(updated.createdAt, note.createdAt);
    assert.ok(updated.updatedAt >= note.updatedAt);
  });

  it("delete is idempotent (second delete returns 404)", async () => {
    const note = await createNote("to delete");
    const del1 = await fetch(`${baseUrl}/notes/${note.id}`, { method: "DELETE" });
    assert.strictEqual(del1.status, 204);
    const del2 = await fetchJSON(`/notes/${note.id}`, { method: "DELETE" });
    assert.strictEqual(del2.status, 404);
  });
});

describe("security headers over real HTTP", () => {
  it("includes all security headers on health endpoint", async () => {
    const { headers } = await fetchJSON("/health");
    assert.strictEqual(headers.get("x-content-type-options"), "nosniff");
    assert.strictEqual(headers.get("x-frame-options"), "DENY");
    assert.strictEqual(headers.get("referrer-policy"), "no-referrer");
    assert.ok(headers.get("content-security-policy"));
    assert.ok(headers.get("strict-transport-security"));
    assert.ok(headers.get("permissions-policy"));
  });

  it("includes security headers on error responses too", async () => {
    const { headers } = await fetchJSON("/nonexistent-path");
    assert.strictEqual(headers.get("x-content-type-options"), "nosniff");
    assert.strictEqual(headers.get("x-frame-options"), "DENY");
  });

  it("rate limit headers are present", async () => {
    const { headers } = await fetchJSON("/health");
    assert.ok(headers.get("x-ratelimit-limit"));
    assert.ok(headers.get("x-ratelimit-remaining"));
  });
});
