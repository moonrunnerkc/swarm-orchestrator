// Tests for uncovered branches in notes-api source code.
// Covers: search filtering (q param), sort equality, pagination with
// limit+offset and offset-only, and logRequests config branch.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { makeApp } from "../src/app.js";

// --- Search, pagination, and sorting edge cases over real HTTP ---

describe("notes search and pagination edge cases", () => {
  let server, baseUrl, tmpDir;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "notes-page-"));
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

    // Seed notes for search/pagination tests
    const notes = [
      { title: "Alpha Recipe", content: "bake a cake" },
      { title: "Beta Guide", content: "learn to code" },
      { title: "Gamma Recipe", content: "cook pasta" },
    ];
    for (const note of notes) {
      await fetch(`${baseUrl}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(note),
      });
    }
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("filters notes by search query matching title", async () => {
    const res = await fetch(`${baseUrl}/notes?q=Recipe`);
    const body = await res.json();
    assert.strictEqual(body.count, 2);
    assert.ok(body.items.every((n) => n.title.includes("Recipe")));
  });

  it("filters notes by search query matching content", async () => {
    const res = await fetch(`${baseUrl}/notes?q=cake`);
    const body = await res.json();
    assert.strictEqual(body.count, 1);
    assert.strictEqual(body.items[0].content, "bake a cake");
  });

  it("search is case-insensitive", async () => {
    const res = await fetch(`${baseUrl}/notes?q=RECIPE`);
    const body = await res.json();
    assert.strictEqual(body.count, 2);
  });

  it("search with no matches returns empty", async () => {
    const res = await fetch(`${baseUrl}/notes?q=zzzznonexistent`);
    const body = await res.json();
    assert.strictEqual(body.count, 0);
    assert.strictEqual(body.total, 0);
  });

  it("search with whitespace-only query returns all notes", async () => {
    const res = await fetch(`${baseUrl}/notes?q=%20%20`);
    const body = await res.json();
    assert.strictEqual(body.count, 3);
  });

  it("supports limit parameter", async () => {
    const res = await fetch(`${baseUrl}/notes?limit=2`);
    const body = await res.json();
    assert.strictEqual(body.count, 2);
    assert.strictEqual(body.total, 3);
  });

  it("supports offset parameter without limit", async () => {
    const res = await fetch(`${baseUrl}/notes?offset=1`);
    const body = await res.json();
    assert.strictEqual(body.count, 2);
    assert.strictEqual(body.total, 3);
  });

  it("supports limit and offset together", async () => {
    const res = await fetch(`${baseUrl}/notes?limit=1&offset=1`);
    const body = await res.json();
    assert.strictEqual(body.count, 1);
    assert.strictEqual(body.total, 3);
  });

  it("sorts by title ascending", async () => {
    const res = await fetch(`${baseUrl}/notes?sort=title&order=asc`);
    const body = await res.json();
    assert.strictEqual(body.items[0].title, "Alpha Recipe");
    assert.strictEqual(body.items[2].title, "Gamma Recipe");
  });

  it("sorts by createdAt ascending", async () => {
    const res = await fetch(`${baseUrl}/notes?sort=createdAt&order=asc`);
    const body = await res.json();
    assert.ok(body.items[0].createdAt <= body.items[1].createdAt);
  });

  it("falls back to updatedAt for invalid sort field", async () => {
    const res = await fetch(`${baseUrl}/notes?sort=bogus`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.items.length, 3);
  });

  it("handles offset beyond total items", async () => {
    const res = await fetch(`${baseUrl}/notes?offset=100`);
    const body = await res.json();
    assert.strictEqual(body.count, 0);
    assert.strictEqual(body.total, 3);
  });

  it("combines search with pagination", async () => {
    const res = await fetch(`${baseUrl}/notes?q=Recipe&limit=1&offset=0`);
    const body = await res.json();
    assert.strictEqual(body.count, 1);
    assert.strictEqual(body.total, 2);
  });
});

// --- App with logRequests enabled ---

describe("notes app with logRequests enabled", () => {
  let server, baseUrl, tmpDir;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "notes-log-"));
    const { app } = makeApp({
      config: {
        port: 0,
        host: "127.0.0.1",
        dataFile: path.join(tmpDir, "data.json"),
        corsOrigin: "*",
        logRequests: true,
        maxTitleLength: 200,
        maxContentLength: 10_000,
        maxBodyBytes: 65536,
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
  });

  it("CRUD works with logging enabled", async () => {
    const createRes = await fetch(`${baseUrl}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Log Test", content: "testing" }),
    });
    assert.strictEqual(createRes.status, 201);
    const note = await createRes.json();
    assert.strictEqual(note.title, "Log Test");
    assert.strictEqual(note.content, "testing");
  });
});
