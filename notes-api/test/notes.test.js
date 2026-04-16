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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "notes-api-test-"));
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

describe("POST /notes", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("creates a note and returns 201", async () => {
    const res = await request(app)
      .post("/notes")
      .send({ title: "Shopping list", content: "Milk, eggs, bread" })
      .expect(201);

    assert.strictEqual(res.body.title, "Shopping list");
    assert.strictEqual(res.body.content, "Milk, eggs, bread");
    assert.ok(res.body.id);
    assert.ok(res.body.createdAt);
    assert.ok(res.body.updatedAt);
  });

  it("trims whitespace from title and content", async () => {
    const res = await request(app)
      .post("/notes")
      .send({ title: "  trimmed  ", content: "  body  " })
      .expect(201);

    assert.strictEqual(res.body.title, "trimmed");
    assert.strictEqual(res.body.content, "body");
  });

  it("allows omitted content (defaults to empty string)", async () => {
    const res = await request(app)
      .post("/notes")
      .send({ title: "No content" })
      .expect(201);

    assert.strictEqual(res.body.content, "");
  });

  it("returns 400 for missing title", async () => {
    const res = await request(app)
      .post("/notes")
      .send({ content: "no title here" })
      .expect(400);

    assert.strictEqual(res.body.error.code, "VALIDATION_ERROR");
  });

  it("returns 400 for non-string title", async () => {
    const res = await request(app)
      .post("/notes")
      .send({ title: 42 })
      .expect(400);

    assert.strictEqual(res.body.error.code, "VALIDATION_ERROR");
    assert.match(res.body.error.message, /string/);
  });

  it("returns 400 for empty body", async () => {
    await request(app)
      .post("/notes")
      .send({})
      .expect(400);
  });

  it("returns 400 for non-string content", async () => {
    const res = await request(app)
      .post("/notes")
      .send({ title: "ok", content: 123 })
      .expect(400);

    assert.strictEqual(res.body.error.code, "VALIDATION_ERROR");
    assert.match(res.body.error.message, /string/);
  });
});

describe("GET /notes", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("returns empty list initially", async () => {
    const res = await request(app).get("/notes").expect(200);
    assert.deepStrictEqual(res.body.items, []);
    assert.strictEqual(res.body.count, 0);
  });

  it("returns all created notes", async () => {
    await request(app).post("/notes").send({ title: "Note 1" });
    await request(app).post("/notes").send({ title: "Note 2" });

    const res = await request(app).get("/notes").expect(200);
    assert.strictEqual(res.body.count, 2);
    assert.strictEqual(res.body.items.length, 2);
  });
});

describe("GET /notes/:id", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("returns a single note", async () => {
    const created = await request(app)
      .post("/notes")
      .send({ title: "Find me", content: "here I am" });

    const res = await request(app)
      .get(`/notes/${created.body.id}`)
      .expect(200);

    assert.strictEqual(res.body.id, created.body.id);
    assert.strictEqual(res.body.title, "Find me");
    assert.strictEqual(res.body.content, "here I am");
  });

  it("returns 404 for nonexistent id", async () => {
    const res = await request(app)
      .get("/notes/00000000-0000-4000-a000-000000000000")
      .expect(404);

    assert.strictEqual(res.body.error.code, "NOT_FOUND");
  });

  it("returns 400 for invalid UUID", async () => {
    const res = await request(app)
      .get("/notes/not-a-uuid")
      .expect(400);

    assert.strictEqual(res.body.error.code, "VALIDATION_ERROR");
    assert.match(res.body.error.message, /UUID/);
  });
});

describe("PUT /notes/:id", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("updates title only", async () => {
    const created = await request(app)
      .post("/notes")
      .send({ title: "old", content: "body" });

    const res = await request(app)
      .put(`/notes/${created.body.id}`)
      .send({ title: "new" })
      .expect(200);

    assert.strictEqual(res.body.title, "new");
    assert.strictEqual(res.body.content, "body");
  });

  it("updates content only", async () => {
    const created = await request(app)
      .post("/notes")
      .send({ title: "keep", content: "old" });

    const res = await request(app)
      .put(`/notes/${created.body.id}`)
      .send({ content: "new content" })
      .expect(200);

    assert.strictEqual(res.body.title, "keep");
    assert.strictEqual(res.body.content, "new content");
  });

  it("updates both title and content", async () => {
    const created = await request(app)
      .post("/notes")
      .send({ title: "a", content: "b" });

    const res = await request(app)
      .put(`/notes/${created.body.id}`)
      .send({ title: "c", content: "d" })
      .expect(200);

    assert.strictEqual(res.body.title, "c");
    assert.strictEqual(res.body.content, "d");
  });

  it("returns 404 when id does not exist", async () => {
    await request(app)
      .put("/notes/00000000-0000-4000-a000-000000000000")
      .send({ title: "nope" })
      .expect(404);
  });

  it("returns 400 when no fields provided", async () => {
    const created = await request(app)
      .post("/notes")
      .send({ title: "test" });

    await request(app)
      .put(`/notes/${created.body.id}`)
      .send({})
      .expect(400);
  });
});

describe("DELETE /notes/:id", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("deletes a note and returns 204", async () => {
    const created = await request(app)
      .post("/notes")
      .send({ title: "delete me" });

    await request(app)
      .delete(`/notes/${created.body.id}`)
      .expect(204);

    await request(app)
      .get(`/notes/${created.body.id}`)
      .expect(404);
  });

  it("returns 404 for nonexistent id", async () => {
    await request(app)
      .delete("/notes/00000000-0000-4000-a000-000000000000")
      .expect(404);
  });
});

describe("error handling", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("returns 404 for unknown routes", async () => {
    const res = await request(app).get("/nonexistent").expect(404);
    assert.strictEqual(res.body.error.code, "ROUTE_NOT_FOUND");
    assert.match(res.body.error.message, /GET \/nonexistent/);
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await request(app)
      .post("/notes")
      .set("content-type", "application/json")
      .send("{bad json")
      .expect(400);

    assert.strictEqual(res.body.error.code, "INVALID_JSON");
  });

  it("includes CORS headers", async () => {
    const res = await request(app)
      .get("/health")
      .set("origin", "http://localhost:5173");

    assert.ok(res.headers["access-control-allow-origin"]);
  });
});
