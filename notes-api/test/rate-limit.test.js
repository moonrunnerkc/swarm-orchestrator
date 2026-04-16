// Tests for the in-memory rate limiter middleware:
// - Enforces per-IP request limits within a sliding window
// - Returns 429 with RATE_LIMITED error when exceeded
// - Sets X-RateLimit-Limit, X-RateLimit-Remaining, and Retry-After headers

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";
import { makeApp } from "../src/app.js";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

describe("rate limiter", () => {
  let tmpDir;
  let request;

  async function createAppWithLimit(maxRequests) {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "notes-ratelimit-"));
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
        rateLimitMax: maxRequests,
      },
    });
    request = supertest(app);
  }

  it("returns 429 when rate limit is exceeded", async () => {
    const limit = 3;
    await createAppWithLimit(limit);

    // Use up the limit
    for (let i = 0; i < limit; i++) {
      const res = await request.get("/health");
      assert.equal(res.status, 200);
      assert.equal(res.headers["x-ratelimit-limit"], String(limit));
      assert.equal(
        res.headers["x-ratelimit-remaining"],
        String(limit - (i + 1)),
      );
    }

    // Next request should be rate limited
    const res = await request.get("/health");
    assert.equal(res.status, 429);
    assert.equal(res.body.error.code, "RATE_LIMITED");
    assert.ok(res.body.error.message.includes("Too many requests"));
    assert.ok(res.headers["retry-after"]);
    assert.equal(res.headers["x-ratelimit-remaining"], "0");
  });

  it("sets X-RateLimit-Remaining to 0 (not negative) when over limit", async () => {
    await createAppWithLimit(1);

    await request.get("/health"); // uses the 1 allowed
    const res = await request.get("/health"); // over limit
    assert.equal(res.status, 429);
    assert.equal(res.headers["x-ratelimit-remaining"], "0");
  });
});
