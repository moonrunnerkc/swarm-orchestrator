// Tests for the file watcher: tailing new content, handling truncation,
// buffering partial lines, and clean shutdown.

import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync, appendFileSync, truncateSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { tailFile } from "../src/watcher.js";

function tmpLog() {
  const dir = mkdtempSync(join(tmpdir(), "logtail-watcher-"));
  const file = join(dir, "test.log");
  writeFileSync(file, "pre-existing content\n");
  return { dir, file };
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

test("tailFile delivers new lines appended after start", async () => {
  const { dir, file } = tmpLog();
  const lines = [];

  try {
    const tailer = await tailFile(file, (line) => lines.push(line), () => {});
    await wait(100);

    appendFileSync(file, "[INFO] hello\n[ERROR] boom\n");
    await wait(300);

    await tailer.stop();
    assert.ok(lines.includes("[INFO] hello"), "should include first appended line");
    assert.ok(lines.includes("[ERROR] boom"), "should include second appended line");
    assert.ok(!lines.some((l) => l.includes("pre-existing")), "should not replay pre-existing content");
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("tailFile buffers partial lines until newline arrives", async () => {
  const { dir, file } = tmpLog();
  const lines = [];

  try {
    const tailer = await tailFile(file, (line) => lines.push(line), () => {});
    await wait(100);

    // Write a partial line (no trailing newline)
    appendFileSync(file, "[WARN] partial");
    await wait(200);
    assert.equal(lines.length, 0, "partial line should not be delivered yet");

    // Complete the line
    appendFileSync(file, " complete\n");
    await wait(300);
    assert.equal(lines.length, 1);
    assert.equal(lines[0], "[WARN] partial complete");

    await tailer.stop();
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("tailFile handles file truncation by resetting offset", async () => {
  const { dir, file } = tmpLog();
  const lines = [];

  try {
    const tailer = await tailFile(file, (line) => lines.push(line), () => {});
    await wait(100);

    appendFileSync(file, "[INFO] before truncation\n");
    await wait(300);

    // Truncate the file (simulates log rotation)
    truncateSync(file, 0);
    await wait(100);

    appendFileSync(file, "[ERROR] after truncation\n");
    await wait(300);

    await tailer.stop();
    assert.ok(lines.includes("[INFO] before truncation"));
    assert.ok(lines.includes("[ERROR] after truncation"));
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("tailFile calls onError for nonexistent file", async () => {
  const errors = [];
  const tailer = await tailFile(
    "/tmp/logtail-watcher-no-such-file.log",
    () => {},
    (err) => errors.push(err)
  );
  await tailer.stop();
  assert.ok(errors.length > 0, "should have called onError");
  assert.ok(errors[0].message.includes("ENOENT") || errors[0].code === "ENOENT");
});

test("stop() can be called multiple times safely", async () => {
  const { dir, file } = tmpLog();

  try {
    const tailer = await tailFile(file, () => {}, () => {});
    await tailer.stop();
    await tailer.stop(); // should not throw
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("tailFile ignores empty lines", async () => {
  const { dir, file } = tmpLog();
  const lines = [];

  try {
    const tailer = await tailFile(file, (line) => lines.push(line), () => {});
    await wait(100);

    appendFileSync(file, "\n\n[INFO] real line\n\n");
    await wait(300);

    await tailer.stop();
    assert.equal(lines.length, 1);
    assert.equal(lines[0], "[INFO] real line");
  } finally {
    rmSync(dir, { recursive: true });
  }
});
