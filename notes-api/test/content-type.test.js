// Tests for Content-Type enforcement middleware:
// - POST/PUT/PATCH without application/json Content-Type get 415
// - GET/DELETE/OPTIONS pass through without Content-Type check
// - Verifies UNSUPPORTED_MEDIA_TYPE error shape

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";
import { makeApp } from "../src/app.js";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

describe("requireJsonContentType middleware", () => {
  let tmpDir;
  let request;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "notes-ct-"));
    const { app } = makeApp({
      config: {
        port: 0,
        host: "127.0.0.1",
        dataFile: path.join(tmpDir, "data.json"),
        corsOrigin: "*",
        logRequests: false,
        maxTitleLength: 200,
        maxContentLength: 10_000,
        maxBodyBytes: 65_536,
        rateLimitWindowMs: 60_000,
        rateLimitMax: 1000,
      },
    });
    request = supertest(app);
  });

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("rejects POST without application/json Content-Type with 415", async () => {
    const res = await request
      .post("/notes")
      .set("Content-Type", "text/plain")
      .send("not json");

    assert.equal(res.status, 415);
    assert.equal(res.body.error.code, "UNSUPPORTED_MEDIA_TYPE");
    assert.ok(res.body.error.message.includes("application/json"));
  });

  it("rejects PUT without application/json Content-Type with 415", async () => {
    const res = await request
      .put("/notes/00000000-0000-4000-a000-000000000000")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("title=test");

    assert.equal(res.status, 415);
    assert.equal(res.body.error.code, "UNSUPPORTED_MEDIA_TYPE");
  });

  it("allows GET requests without Content-Type header", async () => {
    const res = await request.get("/health");
    assert.equal(res.status, 200);
  });

  it("allows DELETE requests without Content-Type header", async () => {
    // Creates a note first, then deletes it
    const create = await request
      .post("/notes")
      .set("Content-Type", "application/json")
      .send({ title: "to delete" });
    assert.equal(create.status, 201);

    const res = await request.delete(`/notes/${create.body.id}`);
    assert.equal(res.status, 204);
  });

  it("rejects POST with no Content-Type header at all", async () => {
    const res = await request
      .post("/notes")
      .unset("Content-Type")
      .send("");

    assert.equal(res.status, 415);
  });
});
