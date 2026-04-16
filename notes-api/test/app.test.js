// Tests for app.js factory: logRequests middleware, store/config overrides, and store.clear().

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { makeApp } from "../src/app.js";

let tmpDir;

function baseConfig(overrides = {}) {
  return {
    port: 0,
    host: "127.0.0.1",
    dataFile: path.join(tmpDir, "data.json"),
    corsOrigin: "*",
    logRequests: false,
    maxTitleLength: 200,
    maxContentLength: 10_000,
    maxBodyBytes: 65536,
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "notes-app-test-"));
});

afterEach(async () => {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("makeApp with logRequests enabled", () => {
  it("logs requests to stdout when logRequests is true", async (t) => {
    const logged = [];
    const origLog = console.log;
    t.after(() => { console.log = origLog; });
    console.log = (...args) => logged.push(args.join(" "));

    const { app } = makeApp({ config: baseConfig({ logRequests: true }) });

    await request(app).get("/health").expect(200);

    assert.ok(logged.length > 0, "should have logged at least one request");
    assert.ok(
      logged.some((line) => line.includes("GET") && line.includes("/health")),
      "log should contain method and path",
    );
  });
});

describe("store.clear", () => {
  it("removes all notes from the store", async () => {
    const { app, store } = makeApp({ config: baseConfig() });

    // Create a couple of notes
    await request(app).post("/notes").send({ title: "A" }).expect(201);
    await request(app).post("/notes").send({ title: "B" }).expect(201);

    let list = await request(app).get("/notes").expect(200);
    assert.strictEqual(list.body.count, 2);

    // Clear via store directly
    const result = await store.clear();
    assert.strictEqual(result, true);

    list = await request(app).get("/notes").expect(200);
    assert.strictEqual(list.body.count, 0);
    assert.deepStrictEqual(list.body.items, []);
  });
});

describe("store resilience", () => {
  it("throws when data file contains invalid JSON", async () => {
    const dataFile = path.join(tmpDir, "data.json");
    await fs.mkdir(path.dirname(dataFile), { recursive: true });
    await fs.writeFile(dataFile, "NOT JSON", "utf8");

    const { app } = makeApp({ config: baseConfig({ dataFile }) });

    const res = await request(app).get("/notes").expect(500);
    assert.strictEqual(res.body.error.code, "INTERNAL_ERROR");
  });

  it("throws when data file has no items array", async () => {
    const dataFile = path.join(tmpDir, "data.json");
    await fs.mkdir(path.dirname(dataFile), { recursive: true });
    await fs.writeFile(dataFile, JSON.stringify({ schemaVersion: 1 }), "utf8");

    const { app } = makeApp({ config: baseConfig({ dataFile }) });

    const res = await request(app).get("/notes").expect(500);
    assert.strictEqual(res.body.error.code, "INTERNAL_ERROR");
  });

  it("throws on permission errors (non-ENOENT)", async () => {
    // Use a path inside a non-existent deeply nested read-only dir to trigger a non-ENOENT error
    const dataFile = path.join(tmpDir, "data.json");
    await fs.mkdir(path.dirname(dataFile), { recursive: true });
    // Write a file that is valid JSON but items is a string, not array
    await fs.writeFile(dataFile, JSON.stringify({ items: "not-an-array" }), "utf8");

    const { app } = makeApp({ config: baseConfig({ dataFile }) });

    const res = await request(app).get("/notes").expect(500);
    assert.strictEqual(res.body.error.code, "INTERNAL_ERROR");
  });
});

describe("update preserves immutable fields", () => {
  it("does not allow overriding id or createdAt via PUT", async () => {
    const { app } = makeApp({ config: baseConfig() });

    const created = await request(app)
      .post("/notes")
      .send({ title: "original" })
      .expect(201);

    const res = await request(app)
      .put(`/notes/${created.body.id}`)
      .send({ title: "changed", id: "fake-id", createdAt: "1999-01-01T00:00:00Z" })
      .expect(200);

    assert.strictEqual(res.body.id, created.body.id, "id must not change");
    assert.strictEqual(res.body.createdAt, created.body.createdAt, "createdAt must not change");
    assert.strictEqual(res.body.title, "changed");
  });

  it("updatedAt changes on update but createdAt stays the same", async () => {
    const { app } = makeApp({ config: baseConfig() });

    const created = await request(app)
      .post("/notes")
      .send({ title: "ts-test" })
      .expect(201);

    // Small delay to ensure timestamps differ
    await new Promise((r) => setTimeout(r, 10));

    const updated = await request(app)
      .put(`/notes/${created.body.id}`)
      .send({ title: "ts-test-updated" })
      .expect(200);

    assert.strictEqual(updated.body.createdAt, created.body.createdAt);
    assert.notStrictEqual(updated.body.updatedAt, created.body.createdAt);
  });
});

describe("DELETE edge cases", () => {
  it("returns 400 for invalid UUID on DELETE", async () => {
    const { app } = makeApp({ config: baseConfig() });

    const res = await request(app)
      .delete("/notes/not-valid")
      .expect(400);

    assert.strictEqual(res.body.error.code, "VALIDATION_ERROR");
  });
});

describe("PUT edge cases", () => {
  it("returns 400 for invalid UUID on PUT", async () => {
    const { app } = makeApp({ config: baseConfig() });

    const res = await request(app)
      .put("/notes/bad-uuid")
      .send({ title: "x" })
      .expect(400);

    assert.strictEqual(res.body.error.code, "VALIDATION_ERROR");
  });
});
