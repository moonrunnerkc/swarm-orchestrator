import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("uses defaults when env is empty", () => {
    const cfg = loadConfig({});
    assert.strictEqual(cfg.port, 3001);
    assert.strictEqual(cfg.host, "127.0.0.1");
    assert.strictEqual(cfg.corsOrigin, "*");
    assert.strictEqual(cfg.logRequests, false);
  });

  it("reads PORT from env", () => {
    const cfg = loadConfig({ PORT: "8080" });
    assert.strictEqual(cfg.port, 8080);
  });

  it("throws for invalid PORT", () => {
    assert.throws(
      () => loadConfig({ PORT: "not-a-number" }),
      /PORT must be an integer/,
    );
  });

  it("throws for out-of-range PORT", () => {
    assert.throws(
      () => loadConfig({ PORT: "99999" }),
      /PORT must be an integer/,
    );
  });

  it("splits comma-separated CORS_ORIGIN", () => {
    const cfg = loadConfig({
      CORS_ORIGIN: "http://localhost:3000, http://localhost:5173",
    });
    assert.deepStrictEqual(cfg.corsOrigin, [
      "http://localhost:3000",
      "http://localhost:5173",
    ]);
  });

  it("parses LOG_REQUESTS boolean", () => {
    assert.strictEqual(loadConfig({ LOG_REQUESTS: "true" }).logRequests, true);
    assert.strictEqual(loadConfig({ LOG_REQUESTS: "0" }).logRequests, false);
  });

  it("throws for invalid boolean value", () => {
    assert.throws(
      () => loadConfig({ LOG_REQUESTS: "yes" }),
      /expected boolean/,
    );
  });

  it("resolves DATA_FILE to absolute path", () => {
    const cfg = loadConfig({ DATA_FILE: "./data/calc.json" });
    assert.ok(cfg.dataFile.startsWith("/"), "should be absolute");
  });

  it("config object is frozen", () => {
    const cfg = loadConfig({});
    assert.throws(() => { cfg.port = 9999; });
  });
});
