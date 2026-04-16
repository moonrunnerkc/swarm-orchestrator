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

test("-h shorthand also prints help", async () => {
  const { code, stdout } = await run("-h");
  assert.equal(code, 0);
  assert.ok(stdout.includes("Usage:"));
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

// --- Additional CLI integration tests ---

test("SIGTERM triggers clean shutdown with stats", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "logtail-"));
  const file = join(tmp, "app.log");
  writeFileSync(file, "");

  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn("node", [CLI, file], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));

      setTimeout(() => {
        appendFileSync(file, "[ERROR] test error\n");
      }, 200);

      // Use SIGTERM instead of SIGINT
      setTimeout(() => child.kill("SIGTERM"), 600);

      child.on("close", (code) => resolve({ code, stdout, stderr }));
      setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("test timed out"));
      }, 5000);
    });

    assert.ok(result.stderr.includes("stats"), "SIGTERM should print stats");
    assert.ok(result.stderr.includes("error:"), "stats should list error count");
  } finally {
    rmSync(tmp, { recursive: true });
  }
});

test("--level error filters out warn and info but shows fatal", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "logtail-"));
  const file = join(tmp, "app.log");
  writeFileSync(file, "");

  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn("node", [CLI, file, "--level", "error"], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));

      setTimeout(() => {
        appendFileSync(file, "[DEBUG] skip\n[INFO] skip\n[WARN] skip\n[ERROR] keep\n[FATAL] keep\n");
      }, 200);

      setTimeout(() => child.kill("SIGINT"), 600);

      child.on("close", (code) => resolve({ code, stdout, stderr }));
      setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("test timed out"));
      }, 5000);
    });

    assert.ok(!result.stdout.includes("[DEBUG] skip"));
    assert.ok(!result.stdout.includes("[INFO] skip"));
    assert.ok(!result.stdout.includes("[WARN] skip"));
    assert.ok(result.stdout.includes("[ERROR] keep"));
    assert.ok(result.stdout.includes("[FATAL] keep"));
  } finally {
    rmSync(tmp, { recursive: true });
  }
});

test("--json wraps non-JSON lines with raw field", async () => {
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
        appendFileSync(file, "[ERROR] plain text line\n");
      }, 200);

      setTimeout(() => child.kill("SIGINT"), 600);

      child.on("close", (code) => resolve({ code, stdout, stderr }));
      setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("test timed out"));
      }, 5000);
    });

    assert.ok(result.stdout.includes('"raw"'), "non-JSON line should be wrapped with raw field");
    assert.ok(result.stdout.includes("[ERROR] plain text line"));
  } finally {
    rmSync(tmp, { recursive: true });
  }
});

test("--level and --json flags can be combined", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "logtail-"));
  const file = join(tmp, "app.log");
  writeFileSync(file, "");

  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn("node", [CLI, file, "--level", "error", "--json"], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));

      setTimeout(() => {
        appendFileSync(file, '[INFO] skip this\n{"level":"error","msg":"show"}\n');
      }, 200);

      setTimeout(() => child.kill("SIGINT"), 600);

      child.on("close", (code) => resolve({ code, stdout, stderr }));
      setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("test timed out"));
      }, 5000);
    });

    // INFO should be filtered out, JSON error line should be pretty-printed
    assert.ok(!result.stdout.includes("skip this"));
    assert.ok(result.stdout.includes('"msg": "show"'));
  } finally {
    rmSync(tmp, { recursive: true });
  }
});

test("stats on exit count all severities seen, not just displayed", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "logtail-"));
  const file = join(tmp, "app.log");
  writeFileSync(file, "");

  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn("node", [CLI, file, "--level", "error"], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));

      setTimeout(() => {
        appendFileSync(file, "[INFO] one\n[INFO] two\n[ERROR] three\n");
      }, 200);

      setTimeout(() => child.kill("SIGINT"), 600);

      child.on("close", (code) => resolve({ code, stdout, stderr }));
      setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("test timed out"));
      }, 5000);
    });

    // Stats should count info lines even though they were filtered from output
    assert.ok(result.stderr.includes("info: 2"), "stats should count filtered lines too");
    assert.ok(result.stderr.includes("error: 1"));
    assert.ok(result.stderr.includes("total: 3"));
  } finally {
    rmSync(tmp, { recursive: true });
  }
});

test("multiple unknown options still exits 1", async () => {
  const { code, stderr } = await run("--foo", "--bar");
  assert.equal(code, 1);
  assert.ok(stderr.includes("Unknown option"));
});
