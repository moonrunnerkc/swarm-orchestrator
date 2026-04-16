// Tests for plain and JSON output formatting.

import test from "node:test";
import assert from "node:assert/strict";
import { formatLine } from "../src/formatter.js";

test("plain mode returns the line unchanged", () => {
  const line = "[ERROR] something broke";
  assert.equal(formatLine(line), line);
  assert.equal(formatLine(line, { json: false }), line);
});

test("json mode pretty-prints valid JSON lines", () => {
  const raw = '{"level":"error","msg":"boom"}';
  const result = formatLine(raw, { json: true });
  assert.equal(result, JSON.stringify(JSON.parse(raw), null, 2));
});

test("json mode wraps non-JSON lines", () => {
  const line = "plain text line";
  const result = formatLine(line, { json: true });
  const parsed = JSON.parse(result);
  assert.equal(parsed.raw, line);
});

test("json mode handles empty string", () => {
  const result = formatLine("", { json: true });
  const parsed = JSON.parse(result);
  assert.equal(parsed.raw, "");
});

// --- Edge cases ---

test("json mode handles nested JSON objects", () => {
  const raw = '{"level":"error","context":{"user":"alice","id":42}}';
  const result = formatLine(raw, { json: true });
  const parsed = JSON.parse(result);
  assert.equal(parsed.context.user, "alice");
  assert.equal(parsed.context.id, 42);
});

test("json mode handles JSON arrays", () => {
  const raw = '[1, 2, 3]';
  const result = formatLine(raw, { json: true });
  const parsed = JSON.parse(result);
  assert.deepEqual(parsed, [1, 2, 3]);
});

test("json mode wraps lines with special characters", () => {
  const line = 'line with "quotes" and \ttabs';
  const result = formatLine(line, { json: true });
  const parsed = JSON.parse(result);
  assert.equal(parsed.raw, line);
});

test("plain mode returns line unchanged even if it looks like JSON", () => {
  const line = '{"key": "value"}';
  assert.equal(formatLine(line), line);
  assert.equal(formatLine(line, { json: false }), line);
});

test("formatLine defaults to plain mode when no options given", () => {
  const line = "some line";
  assert.equal(formatLine(line), line);
});
