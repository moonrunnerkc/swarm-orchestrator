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

// --- Edge cases ---

test("parseSeverity handles mixed case like [Error] or [Warn]", () => {
  assert.equal(parseSeverity("[Error] mixed case"), "error");
  assert.equal(parseSeverity("[Warn] mixed case"), "warn");
  assert.equal(parseSeverity("[Fatal] crash"), "fatal");
});

test("parseSeverity detects severity mid-line with context prefix", () => {
  assert.equal(parseSeverity("2024-01-01T00:00:00Z [ERROR] something"), "error");
  assert.equal(parseSeverity("app: info: booting"), "info");
});

test("parseSeverity returns null for partial matches", () => {
  // "information" contains "info" but not in the expected format
  assert.equal(parseSeverity("information about topic"), null);
  // "warning" alone (no bracket or colon suffix)
  assert.equal(parseSeverity("this is a warning sign"), null);
});

test("meetsThreshold handles all level combinations at boundaries", () => {
  // debug is lowest, everything meets debug threshold
  for (const l of LEVELS) {
    assert.equal(meetsThreshold(l, "debug"), true, `${l} should meet debug threshold`);
  }
  // fatal is highest, only fatal meets fatal threshold
  for (const l of LEVELS) {
    if (l === "fatal") {
      assert.equal(meetsThreshold(l, "fatal"), true);
    } else {
      assert.equal(meetsThreshold(l, "fatal"), false, `${l} should not meet fatal threshold`);
    }
  }
});

test("meetsThreshold handles unknown severity gracefully", () => {
  // Unknown severity gets rank -1, should fail any threshold
  assert.equal(meetsThreshold("unknown", "debug"), false);
});

test("LEVELS has exactly 5 entries in expected order", () => {
  assert.deepEqual(LEVELS, ["debug", "info", "warn", "error", "fatal"]);
});
