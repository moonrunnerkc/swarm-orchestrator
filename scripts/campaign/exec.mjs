/**
 * Running one command for the campaign and keeping what it did. Every command a launch runs is
 * recorded with its argv, working directory, exit status, signal and wall time, and its complete
 * stdout and stderr are stored once by SHA-256 digest beside the launch record, so a later reader
 * can see exactly what an agent or verifier printed, not a summary of it.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const digestOf = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** Store bytes under their digest; identical output is stored once and never rewritten. */
export function storeBlob(blobDirectory, bytes) {
  const digest = digestOf(bytes);
  mkdirSync(blobDirectory, { recursive: true });
  const path = join(blobDirectory, digest.slice(7));
  if (!existsSync(path)) writeFileSync(path, bytes, { flag: "wx" });
  return digest;
}

/**
 * Run argv to completion, to its deadline, or to an abort of `signal` (the interrupt procedure). A command past its deadline is killed with its
 * whole process group and reported with the signal, never as an exit code it did not produce.
 */
export function runCommand(
  argv,
  { cwd, env = process.env, timeoutMs, input = null, signal = null },
) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env,
      detached: true,
      stdio: [input === null ? "ignore" : "pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    if (input !== null) child.stdin.end(input);
    let timedOut = false;
    let interrupted = false;
    // Killing a docker client leaves its container running, so a named container is removed too.
    const container =
      argv[0] === "docker" && argv[1] === "run" ? argv[argv.indexOf("--name") + 1] : null;
    const killGroup = () => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      if (container) spawnSync("docker", ["rm", "-f", container], { stdio: "ignore" });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, timeoutMs);
    const onAbort = () => {
      interrupted = true;
      killGroup();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const finish = (exitCode, exitSignal, spawnError = null) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({
        argv: [...argv],
        cwd,
        exitCode,
        signal: timedOut ? "SIGKILL(deadline)" : interrupted ? "SIGKILL(interrupted)" : exitSignal,
        wallMs: Date.now() - started,
        stdout: Buffer.concat(stdout),
        stderr: spawnError === null ? Buffer.concat(stderr) : Buffer.from(String(spawnError)),
      });
    };
    child.on("error", (error) => finish(null, null, error));
    child.on("close", (code, signal) => finish(code, signal));
  });
}

/** The recorded form of a finished command, its output moved into the blob store. */
export function recordOf(result, blobDirectory) {
  return {
    argv: result.argv,
    cwd: result.cwd,
    exitCode: result.exitCode,
    signal: result.signal,
    wallMs: result.wallMs,
    stdoutDigest: storeBlob(blobDirectory, result.stdout),
    stderrDigest: storeBlob(blobDirectory, result.stderr),
    stdoutBytes: result.stdout.length,
    stderrBytes: result.stderr.length,
  };
}

/** A command log bound to one launch: run, record, and hand the result back. */
export function commandLog(blobDirectory) {
  const commands = [];
  return {
    commands,
    async run(argv, options) {
      const result = await runCommand(argv, options);
      commands.push(recordOf(result, blobDirectory));
      return result;
    },
  };
}
