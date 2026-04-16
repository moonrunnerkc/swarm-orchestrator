// Tests for severity stats tracking and summary formatting.

import test from "node:test";
import assert from "node:assert/strict";
import { createStats } from "../src/stats.js";

test("fresh stats have zero counts", () => {
  const s = createStats();
  const summary = s.summary();
  assert.equal(summary.total, 0);
  assert.equal(summary.error, 0);
  assert.equal(summary.info, 0);
});

test("record increments the matching severity and total", () => {
  const s = createStats();
  s.record("error");
  s.record("error");
  s.record("info");
  const summary = s.summary();
  assert.equal(summary.error, 2);
  assert.equal(summary.info, 1);
  assert.equal(summary.total, 3);
});

test("formatSummary includes all levels and a total", () => {
  const s = createStats();
  s.record("warn");
  const text = s.formatSummary();
  assert.ok(text.includes("warn: 1"));
  assert.ok(text.includes("total: 1"));
  assert.ok(text.includes("error: 0"));
});
