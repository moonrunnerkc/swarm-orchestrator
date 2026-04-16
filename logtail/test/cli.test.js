// Integration tests for the CLI entry point: arg validation, help output,
// exit codes, live tailing, and stats on shutdown.

import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "src", "cli.js");

function run(...args) {
  return new Promise((resolve) => {
    execFile("node", [CLI, ...args], (err, stdout, stderr) => {
      resolve({ code: err?.code ?? 0, stdout, stderr });
    });
  });
}

test("--help prints usage and exits 0", async () => {
  const { code, stdout } = await run("--help");
  assert.equal(code, 0);
  assert.ok(stdout.includes("Usage:"));
  assert.ok(stdout.includes("--level"));
  assert.ok(stdout.includes("--json"));
  assert.ok(stdout.includes("Examples:"));
});

test("no arguments exits 1 with an error", async () => {
  const { code, stderr } = await run();
  assert.equal(code, 1);
  assert.ok(stderr.includes("no log file specified"));
});

test("invalid --level exits 1 with valid options listed", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "logtail-"));
  const file = join(tmp, "test.log");
  writeFileSync(file, "");
  try {
    const { code, stderr } = await run(file, "--level", "critical");
    assert.equal(code, 1);
    assert.ok(stderr.includes("invalid level"));
    assert.ok(stderr.includes("error"));
  } finally {
    rmSync(tmp, { recursive: true });
  }
});

test("nonexistent file exits 2", async () => {
  const { code, stderr } = await run("/tmp/logtail-no-such-file-ever.log");
  assert.equal(code, 2);
  assert.ok(stderr.includes("file not found"));
});

test("unknown option exits 1", async () => {
  const { code, stderr } = await run("--bogus");
  assert.equal(code, 1);
  assert.ok(stderr.includes("Unknown option"));
});

test("tails a file and filters by severity", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "logtail-"));
  const file = join(tmp, "app.log");
  writeFileSync(file, "");

  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn("node", [CLI, file, "--level", "warn"], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));

      // Give the watcher time to start, then append lines.
      setTimeout(() => {
        appendFileSync(file, "[INFO] skipped\n[ERROR] caught\n[WARN] included\n");
      }, 200);

      // Give it time to read, then signal shutdown.
      setTimeout(() => child.kill("SIGINT"), 600);

      child.on("close", (code) => resolve({ code, stdout, stderr }));
      setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("test timed out"));
      }, 5000);
    });

    assert.ok(result.stdout.includes("[ERROR] caught"));
    assert.ok(result.stdout.includes("[WARN] included"));
    assert.ok(!result.stdout.includes("[INFO] skipped"));
    assert.ok(result.stderr.includes("stats"));
  } finally {
    rmSync(tmp, { recursive: true });
  }
});

test("--json mode pretty-prints output", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "logtail-"));
  const file = join(tmp, "app.log");
  writeFileSync(file, "");

  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn("node", [CLI, file, "--json"], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));

      setTimeout(() => {
        appendFileSync(file, '{"level":"error","msg":"boom"}\n');
      }, 200);

      setTimeout(() => child.kill("SIGINT"), 600);

      child.on("close", (code) => resolve({ code, stdout, stderr }));
      setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("test timed out"));
      }, 5000);
    });

    assert.ok(result.stdout.includes('"level": "error"'));
    assert.ok(result.stdout.includes('"msg": "boom"'));
  } finally {
    rmSync(tmp, { recursive: true });
  }
});
