// Edge-case tests for the notes API. Covers title/content length limits,
// response field names, CRUD lifecycle, and boundary inputs.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { makeApp } from "../src/app.js";

let tmpDir;
let app;

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "notes-edge-"));
  const result = makeApp({
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
  app = result.app;
}

async function teardown() {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
}

describe("response field names (must match backend schema)", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("POST response contains exactly the expected fields", async () => {
    const res = await request(app)
      .post("/notes")
      .send({ title: "test", content: "body" })
      .expect(201);

    const expectedFields = ["id", "title", "content", "createdAt", "updatedAt"];
    assert.deepStrictEqual(Object.keys(res.body).sort(), expectedFields.sort());
  });

  it("GET list response has items array and count", async () => {
    await request(app).post("/notes").send({ title: "one" });
    const res = await request(app).get("/notes").expect(200);

    assert.ok(Array.isArray(res.body.items));
    assert.strictEqual(typeof res.body.count, "number");
    assert.strictEqual(res.body.count, res.body.items.length);
  });

  it("error response follows { error: { code, message } } shape", async () => {
    const res = await request(app)
      .post("/notes")
      .send({ title: 42 })
      .expect(400);

    assert.ok(res.body.error);
    assert.strictEqual(typeof res.body.error.code, "string");
    assert.strictEqual(typeof res.body.error.message, "string");
  });

  it("health response contains status, service, version, uptimeSeconds, timestamp", async () => {
    const res = await request(app).get("/health").expect(200);
    assert.strictEqual(res.body.status, "ok");
    assert.strictEqual(typeof res.body.service, "string");
    assert.strictEqual(typeof res.body.version, "string");
    assert.strictEqual(typeof res.body.uptimeSeconds, "number");
    assert.strictEqual(typeof res.body.timestamp, "string");
  });
});

describe("title length limits", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("accepts title at exactly max length (200 chars)", async () => {
    const title = "a".repeat(200);
    const res = await request(app)
      .post("/notes")
      .send({ title })
      .expect(201);

    assert.strictEqual(res.body.title, title);
  });

  it("rejects title one char over max length", async () => {
    const title = "a".repeat(201);
    const res = await request(app)
      .post("/notes")
      .send({ title })
      .expect(400);

    assert.strictEqual(res.body.error.code, "VALIDATION_ERROR");
    assert.match(res.body.error.message, /exceeds maximum/);
  });
});

describe("content length limits", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("accepts content at exactly max length (10000 chars)", async () => {
    const content = "a".repeat(10_000);
    const res = await request(app)
      .post("/notes")
      .send({ title: "big note", content })
      .expect(201);

    assert.strictEqual(res.body.content.length, 10_000);
  });

  it("rejects content one char over max length", async () => {
    const content = "a".repeat(10_001);
    const res = await request(app)
      .post("/notes")
      .send({ title: "too big", content })
      .expect(400);

    assert.strictEqual(res.body.error.code, "VALIDATION_ERROR");
    assert.match(res.body.error.message, /exceeds maximum/);
  });
});

describe("full CRUD lifecycle", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("create → read → update → verify → delete → confirm gone", async () => {
    // Create
    const created = await request(app)
      .post("/notes")
      .send({ title: "Lifecycle note", content: "initial" })
      .expect(201);

    assert.strictEqual(created.body.title, "Lifecycle note");
    const id = created.body.id;

    // Read
    const fetched = await request(app).get(`/notes/${id}`).expect(200);
    assert.strictEqual(fetched.body.id, id);
    assert.strictEqual(fetched.body.content, "initial");

    // Update
    const updated = await request(app)
      .put(`/notes/${id}`)
      .send({ title: "Updated title", content: "updated body" })
      .expect(200);

    assert.strictEqual(updated.body.title, "Updated title");
    assert.strictEqual(updated.body.content, "updated body");
    assert.strictEqual(updated.body.id, id);
    assert.strictEqual(updated.body.createdAt, created.body.createdAt);
    assert.notStrictEqual(updated.body.updatedAt, created.body.updatedAt);

    // Delete
    await request(app).delete(`/notes/${id}`).expect(204);

    // Confirm gone
    await request(app).get(`/notes/${id}`).expect(404);

    // Confirm list is empty
    const list = await request(app).get("/notes").expect(200);
    assert.strictEqual(list.body.count, 0);
  });
});

describe("boundary and unusual inputs", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("handles unicode in title and content", async () => {
    const res = await request(app)
      .post("/notes")
      .send({ title: "日本語のノート", content: "コンテンツ 🎉" })
      .expect(201);

    assert.strictEqual(res.body.title, "日本語のノート");
    assert.strictEqual(res.body.content, "コンテンツ 🎉");
  });

  it("handles empty content string", async () => {
    const res = await request(app)
      .post("/notes")
      .send({ title: "Empty body", content: "" })
      .expect(201);

    assert.strictEqual(res.body.content, "");
  });

  it("handles multiline content", async () => {
    const content = "line 1\nline 2\nline 3";
    const res = await request(app)
      .post("/notes")
      .send({ title: "Multiline", content })
      .expect(201);

    assert.strictEqual(res.body.content, content);
  });

  it("returns x-powered-by disabled", async () => {
    const res = await request(app).get("/health");
    assert.strictEqual(res.headers["x-powered-by"], undefined);
  });

  it("rejects request with Content-Type but invalid JSON", async () => {
    const res = await request(app)
      .post("/notes")
      .set("content-type", "application/json")
      .send("not json at all{{{")
      .expect(400);

    assert.strictEqual(res.body.error.code, "INVALID_JSON");
  });
});
