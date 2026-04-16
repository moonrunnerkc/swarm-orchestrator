import { describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { makeApp } from "../src/app.js";

describe("GET /health", () => {
  const { app } = makeApp({
    config: {
      port: 0,
      host: "127.0.0.1",
      dataFile: "/tmp/notes-health-test.json",
      corsOrigin: "*",
      logRequests: false,
      maxTitleLength: 200,
      maxContentLength: 10_000,
      maxBodyBytes: 65536,
    },
  });

  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/health").expect(200);
    assert.strictEqual(res.body.status, "ok");
    assert.strictEqual(res.body.service, "notes-api");
    assert.strictEqual(typeof res.body.version, "string");
    assert.strictEqual(typeof res.body.uptimeSeconds, "number");
    assert.strictEqual(typeof res.body.timestamp, "string");
  });

  it("responds with JSON content-type", async () => {
    await request(app)
      .get("/health")
      .expect("content-type", /application\/json/);
  });
});
