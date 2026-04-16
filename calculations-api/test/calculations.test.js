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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "calc-api-test-"));
  const result = makeApp({
    config: {
      port: 0,
      host: "127.0.0.1",
      dataFile: path.join(tmpDir, "data.json"),
      corsOrigin: "*",
      logRequests: false,
      maxExpressionLength: 200,
      maxTitleLength: 100,
      maxBodyBytes: 16384,
    },
  });
  app = result.app;
}

async function teardown() {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
}

describe("POST /calculations", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("creates a calculation and returns 201", async () => {
    const res = await request(app)
      .post("/calculations")
      .send({ expression: "2 + 3", title: "simple add" })
      .expect(201);

    assert.strictEqual(res.body.expression, "2 + 3");
    assert.strictEqual(res.body.result, 5);
    assert.strictEqual(res.body.title, "simple add");
    assert.ok(res.body.id);
    assert.ok(res.body.createdAt);
    assert.ok(res.body.updatedAt);
  });

  it("trims whitespace from expression and title", async () => {
    const res = await request(app)
      .post("/calculations")
      .send({ expression: "  7 * 8  ", title: "  trimmed  " })
      .expect(201);

    assert.strictEqual(res.body.expression, "7 * 8");
    assert.strictEqual(res.body.title, "trimmed");
    assert.strictEqual(res.body.result, 56);
  });

  it("allows null title", async () => {
    const res = await request(app)
      .post("/calculations")
      .send({ expression: "9 / 3" })
      .expect(201);

    assert.strictEqual(res.body.title, null);
    assert.strictEqual(res.body.result, 3);
  });

  it("returns 400 for missing expression", async () => {
    const res = await request(app)
      .post("/calculations")
      .send({ title: "no expression" })
      .expect(400);

    assert.strictEqual(res.body.error.code, "VALIDATION_ERROR");
  });

  it("returns 400 for non-string expression", async () => {
    const res = await request(app)
      .post("/calculations")
      .send({ expression: 42 })
      .expect(400);

    assert.strictEqual(res.body.error.code, "VALIDATION_ERROR");
    assert.match(res.body.error.message, /string/);
  });

  it("returns 422 for division by zero", async () => {
    const res = await request(app)
      .post("/calculations")
      .send({ expression: "10 / 0" })
      .expect(422);

    assert.strictEqual(res.body.error.code, "EVALUATION_ERROR");
    assert.match(res.body.error.message, /division by zero/);
  });

  it("returns 422 for invalid expression syntax", async () => {
    const res = await request(app)
      .post("/calculations")
      .send({ expression: "2 @ 3" })
      .expect(422);

    assert.strictEqual(res.body.error.code, "EVALUATION_ERROR");
  });

  it("returns 400 for empty body", async () => {
    await request(app)
      .post("/calculations")
      .send({})
      .expect(400);
  });
});

describe("GET /calculations", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("returns empty list initially", async () => {
    const res = await request(app).get("/calculations").expect(200);
    assert.deepStrictEqual(res.body.items, []);
    assert.strictEqual(res.body.count, 0);
  });

  it("returns all created calculations", async () => {
    await request(app).post("/calculations").send({ expression: "1+1" });
    await request(app).post("/calculations").send({ expression: "2+2" });

    const res = await request(app).get("/calculations").expect(200);
    assert.strictEqual(res.body.count, 2);
    assert.strictEqual(res.body.items.length, 2);
  });
});

describe("GET /calculations/:id", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("returns a single calculation", async () => {
    const created = await request(app)
      .post("/calculations")
      .send({ expression: "5 * 5", title: "square" });

    const res = await request(app)
      .get(`/calculations/${created.body.id}`)
      .expect(200);

    assert.strictEqual(res.body.id, created.body.id);
    assert.strictEqual(res.body.result, 25);
  });

  it("returns 404 for nonexistent id", async () => {
    const res = await request(app)
      .get("/calculations/00000000-0000-4000-a000-000000000000")
      .expect(404);

    assert.strictEqual(res.body.error.code, "NOT_FOUND");
  });

  it("returns 400 for invalid UUID", async () => {
    const res = await request(app)
      .get("/calculations/not-a-uuid")
      .expect(400);

    assert.strictEqual(res.body.error.code, "VALIDATION_ERROR");
    assert.match(res.body.error.message, /UUID/);
  });
});

describe("PUT /calculations/:id", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("updates expression and recalculates", async () => {
    const created = await request(app)
      .post("/calculations")
      .send({ expression: "1+1", title: "original" });

    const res = await request(app)
      .put(`/calculations/${created.body.id}`)
      .send({ expression: "10 + 20" })
      .expect(200);

    assert.strictEqual(res.body.result, 30);
    assert.strictEqual(res.body.expression, "10 + 20");
    assert.strictEqual(res.body.title, "original");
  });

  it("updates title only without changing result", async () => {
    const created = await request(app)
      .post("/calculations")
      .send({ expression: "3+3", title: "old" });

    const res = await request(app)
      .put(`/calculations/${created.body.id}`)
      .send({ title: "new" })
      .expect(200);

    assert.strictEqual(res.body.title, "new");
    assert.strictEqual(res.body.result, 6);
    assert.strictEqual(res.body.expression, "3+3");
  });

  it("returns 404 when id does not exist", async () => {
    await request(app)
      .put("/calculations/00000000-0000-4000-a000-000000000000")
      .send({ title: "nope" })
      .expect(404);
  });

  it("returns 400 when no fields provided", async () => {
    const created = await request(app)
      .post("/calculations")
      .send({ expression: "1+1" });

    await request(app)
      .put(`/calculations/${created.body.id}`)
      .send({})
      .expect(400);
  });
});

describe("DELETE /calculations/:id", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("deletes a calculation and returns 204", async () => {
    const created = await request(app)
      .post("/calculations")
      .send({ expression: "9-3" });

    await request(app)
      .delete(`/calculations/${created.body.id}`)
      .expect(204);

    await request(app)
      .get(`/calculations/${created.body.id}`)
      .expect(404);
  });

  it("returns 404 for nonexistent id", async () => {
    await request(app)
      .delete("/calculations/00000000-0000-4000-a000-000000000000")
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
      .post("/calculations")
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
