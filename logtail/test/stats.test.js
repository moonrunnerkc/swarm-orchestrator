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

// --- Edge cases ---

test("record ignores unknown severities but still increments total", () => {
  const s = createStats();
  s.record("unknown");
  const summary = s.summary();
  assert.equal(summary.total, 1);
  // Known levels stay at 0
  assert.equal(summary.debug, 0);
  assert.equal(summary.info, 0);
  assert.equal(summary.error, 0);
});

test("summary returns a snapshot, not a live reference", () => {
  const s = createStats();
  const snap = s.summary();
  s.record("error");
  // The snapshot should not be affected by later records
  assert.equal(snap.error, 0);
  assert.equal(snap.total, 0);
});

test("formatSummary includes stats header", () => {
  const s = createStats();
  const text = s.formatSummary();
  assert.ok(text.includes("--- stats ---"));
});

test("summary includes all five severity levels", () => {
  const s = createStats();
  const summary = s.summary();
  for (const level of ["debug", "info", "warn", "error", "fatal"]) {
    assert.ok(level in summary, `summary should include ${level}`);
  }
  assert.ok("total" in summary, "summary should include total");
});
