// Tests for GET /calculations/stats aggregate endpoint.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { makeApp } from "../src/app.js";
import { createStore } from "../src/store.js";
import { loadConfig } from "../src/config.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

let request;

async function loadSupertest() {
  const mod = await import("supertest");
  return mod.default;
}

describe("GET /calculations/stats", () => {
  let app, tmpDir, dataFile, store;

  beforeEach(async () => {
    request = await loadSupertest();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "calc-stats-"));
    dataFile = path.join(tmpDir, "data.json");
    const cfg = { ...loadConfig({}), dataFile };
    store = createStore({ dataFile });
    ({ app } = makeApp({ config: cfg, store }));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns zeroed stats when no calculations exist", async () => {
    const res = await request(app).get("/calculations/stats");
    assert.equal(res.status, 200);
    assert.deepStrictEqual(res.body, {
      totalCalculations: 0,
      averageResult: null,
      minResult: null,
      maxResult: null,
      lastCalculatedAt: null,
    });
  });

  it("computes correct stats for multiple calculations", async () => {
    await request(app)
      .post("/calculations")
      .set("Content-Type", "application/json")
      .send({ expression: "10 + 10" }); // result: 20

    await request(app)
      .post("/calculations")
      .set("Content-Type", "application/json")
      .send({ expression: "5 * 2" }); // result: 10

    await request(app)
      .post("/calculations")
      .set("Content-Type", "application/json")
      .send({ expression: "3 + 3" }); // result: 6

    const res = await request(app).get("/calculations/stats");
    assert.equal(res.status, 200);
    assert.equal(res.body.totalCalculations, 3);
    assert.equal(res.body.averageResult, 12);
    assert.equal(res.body.minResult, 6);
    assert.equal(res.body.maxResult, 20);
    assert.ok(res.body.lastCalculatedAt);
  });

  it("returns correct stats for a single calculation", async () => {
    await request(app)
      .post("/calculations")
      .set("Content-Type", "application/json")
      .send({ expression: "42" });

    const res = await request(app).get("/calculations/stats");
    assert.equal(res.body.totalCalculations, 1);
    assert.equal(res.body.averageResult, 42);
    assert.equal(res.body.minResult, 42);
    assert.equal(res.body.maxResult, 42);
  });

  it("includes negative results in min calculation", async () => {
    await request(app)
      .post("/calculations")
      .set("Content-Type", "application/json")
      .send({ expression: "0 - 100" });

    await request(app)
      .post("/calculations")
      .set("Content-Type", "application/json")
      .send({ expression: "50" });

    const res = await request(app).get("/calculations/stats");
    assert.equal(res.body.minResult, -100);
    assert.equal(res.body.maxResult, 50);
    assert.equal(res.body.averageResult, -25);
  });

  it("has the expected response fields", async () => {
    const res = await request(app).get("/calculations/stats");
    const keys = Object.keys(res.body).sort();
    assert.deepStrictEqual(keys, [
      "averageResult",
      "lastCalculatedAt",
      "maxResult",
      "minResult",
      "totalCalculations",
    ]);
  });
});
