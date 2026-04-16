// Tests for severity parsing and threshold filtering.

import test from "node:test";
import assert from "node:assert/strict";
import { parseSeverity, meetsThreshold, isValidLevel, LEVELS } from "../src/filter.js";

test("parseSeverity extracts bracketed levels like [ERROR]", () => {
  assert.equal(parseSeverity("[ERROR] disk full"), "error");
  assert.equal(parseSeverity("[info] server started"), "info");
  assert.equal(parseSeverity("[WARN] high memory"), "warn");
  assert.equal(parseSeverity("[DEBUG] trace id=42"), "debug");
  assert.equal(parseSeverity("[FATAL] segfault"), "fatal");
});

test("parseSeverity extracts colon-suffixed levels like error:", () => {
  assert.equal(parseSeverity("error: connection refused"), "error");
  assert.equal(parseSeverity("INFO: booting"), "info");
});

test("parseSeverity returns null for lines without a recognized level", () => {
  assert.equal(parseSeverity("just a plain line"), null);
  assert.equal(parseSeverity(""), null);
  assert.equal(parseSeverity("2024-01-01 some event"), null);
});

test("meetsThreshold returns true when severity >= threshold", () => {
  assert.equal(meetsThreshold("error", "warn"), true);
  assert.equal(meetsThreshold("fatal", "debug"), true);
  assert.equal(meetsThreshold("warn", "warn"), true);
});

test("meetsThreshold returns false when severity < threshold", () => {
  assert.equal(meetsThreshold("debug", "info"), false);
  assert.equal(meetsThreshold("info", "warn"), false);
  assert.equal(meetsThreshold("warn", "error"), false);
});

test("isValidLevel accepts all known levels", () => {
  for (const l of LEVELS) {
    assert.equal(isValidLevel(l), true);
  }
});

test("isValidLevel rejects unknown strings", () => {
  assert.equal(isValidLevel("critical"), false);
  assert.equal(isValidLevel(""), false);
  assert.equal(isValidLevel("WARNING"), false);
});
