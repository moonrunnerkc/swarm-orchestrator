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
