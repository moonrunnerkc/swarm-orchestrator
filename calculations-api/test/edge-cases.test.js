// Edge-case tests for the calculations API. Covers expression/title length limits,
// response field names matching the backend schema, CRUD lifecycle, and boundary inputs.

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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "calc-edge-"));
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

describe("response field names (must match backend schema)", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("POST response contains exactly the expected fields", async () => {
    const res = await request(app)
      .post("/calculations")
      .send({ expression: "2+2", title: "test" })
      .expect(201);

    const expectedFields = ["id", "title", "expression", "result", "createdAt", "updatedAt"];
    assert.deepStrictEqual(Object.keys(res.body).sort(), expectedFields.sort());
  });

  it("GET list response has items array and count", async () => {
    await request(app).post("/calculations").send({ expression: "1+1" });
    const res = await request(app).get("/calculations").expect(200);

    assert.ok(Array.isArray(res.body.items));
    assert.strictEqual(typeof res.body.count, "number");
    assert.strictEqual(res.body.count, res.body.items.length);
  });

  it("error response follows { error: { code, message } } shape", async () => {
    const res = await request(app)
      .post("/calculations")
      .send({ expression: 42 })
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

describe("expression length limits", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("accepts expression at exactly max length", async () => {
    // Build an expression that's exactly 200 chars when trimmed
    const expr = "1+" + "1+".repeat(98) + "11"; // "1+" (2) + "1+" * 98 (196) + "11" (2) = 200
    assert.strictEqual(expr.length, 200);

    const res = await request(app)
      .post("/calculations")
      .send({ expression: expr })
      .expect(201);

    assert.strictEqual(typeof res.body.result, "number");
  });

  it("rejects expression one char over max length", async () => {
    const expr = "1+" + "1+".repeat(99) + "1"; // "1+" (2) + "1+" * 99 (198) + "1" (1) = 201
    assert.strictEqual(expr.length, 201);

    const res = await request(app)
      .post("/calculations")
      .send({ expression: expr })
      .expect(400);

    assert.strictEqual(res.body.error.code, "VALIDATION_ERROR");
    assert.match(res.body.error.message, /exceeds maximum/);
  });
});

describe("title length limits", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("accepts title at exactly 100 characters", async () => {
    const title = "a".repeat(100);
    const res = await request(app)
      .post("/calculations")
      .send({ expression: "1+1", title })
      .expect(201);

    assert.strictEqual(res.body.title, title);
  });

  it("rejects title at 101 characters", async () => {
    const title = "a".repeat(101);
    const res = await request(app)
      .post("/calculations")
      .send({ expression: "1+1", title })
      .expect(400);

    assert.strictEqual(res.body.error.code, "VALIDATION_ERROR");
  });
});

describe("full CRUD lifecycle", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("create → read → update → verify → delete → confirm gone", async () => {
    // Create
    const created = await request(app)
      .post("/calculations")
      .send({ expression: "10 + 5", title: "lifecycle" })
      .expect(201);

    assert.strictEqual(created.body.result, 15);
    const id = created.body.id;

    // Read
    const fetched = await request(app).get(`/calculations/${id}`).expect(200);
    assert.strictEqual(fetched.body.id, id);
    assert.strictEqual(fetched.body.result, 15);

    // Update expression (should recalculate)
    const updated = await request(app)
      .put(`/calculations/${id}`)
      .send({ expression: "20 * 3", title: "updated" })
      .expect(200);

    assert.strictEqual(updated.body.result, 60);
    assert.strictEqual(updated.body.title, "updated");
    assert.strictEqual(updated.body.id, id);
    assert.strictEqual(updated.body.createdAt, created.body.createdAt);
    assert.notStrictEqual(updated.body.updatedAt, created.body.updatedAt);

    // Delete
    await request(app).delete(`/calculations/${id}`).expect(204);

    // Confirm gone
    await request(app).get(`/calculations/${id}`).expect(404);

    // Confirm list is empty
    const list = await request(app).get("/calculations").expect(200);
    assert.strictEqual(list.body.count, 0);
  });
});

describe("boundary and unusual inputs", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("handles deeply nested parentheses", async () => {
    const res = await request(app)
      .post("/calculations")
      .send({ expression: "((((1+2))))" })
      .expect(201);

    assert.strictEqual(res.body.result, 3);
  });

  it("handles negative result", async () => {
    const res = await request(app)
      .post("/calculations")
      .send({ expression: "3 - 10" })
      .expect(201);

    assert.strictEqual(res.body.result, -7);
  });

  it("handles zero result", async () => {
    const res = await request(app)
      .post("/calculations")
      .send({ expression: "5 - 5" })
      .expect(201);

    assert.strictEqual(res.body.result, 0);
  });

  it("handles very small decimal result", async () => {
    const res = await request(app)
      .post("/calculations")
      .send({ expression: "1 / 1000000" })
      .expect(201);

    assert.strictEqual(res.body.result, 0.000001);
  });

  it("handles unary plus", async () => {
    const res = await request(app)
      .post("/calculations")
      .send({ expression: "+5 + 3" })
      .expect(201);

    assert.strictEqual(res.body.result, 8);
  });

  it("returns x-powered-by disabled", async () => {
    const res = await request(app).get("/health");
    assert.strictEqual(res.headers["x-powered-by"], undefined);
  });

  it("rejects request with Content-Type but invalid JSON", async () => {
    const res = await request(app)
      .post("/calculations")
      .set("content-type", "application/json")
      .send("not json at all{{{")
      .expect(400);

    assert.strictEqual(res.body.error.code, "INVALID_JSON");
  });
});
