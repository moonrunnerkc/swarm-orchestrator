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
 * Run argv to completion, to its deadline, or to an abort of `signal` (the interrupt procedure).
 * A command past its deadline is killed with its whole process group and reported with the
 * signal, never as an exit code it did not produce.
 *
 * `killConfirmMs` bounds how long a kill waits to be confirmed: a child whose descendants escaped
 * the group can hold the output pipes open after the leader is dead, and a caller that has to
 * stop promptly cannot wait on them. Past that bound the result is returned with the output seen
 * so far and `termination.confirmed` false; the pipes are left to the process's exit.
 *
 * `onStdout` is called with each chunk of standard output as it arrives, for a caller that
 * watches the command while it runs; the recorded output is unchanged by it.
 */
export function runCommand(
  argv,
  {
    cwd,
    env = process.env,
    timeoutMs,
    input = null,
    signal = null,
    killConfirmMs = null,
    onSpawn = null,
    onStdout = null,
  },
) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env,
      detached: true,
      stdio: [input === null ? "ignore" : "pipe", "pipe", "pipe"],
    });
    // The caller may need the child's identity while it runs, to record what it owns.
    if (child.pid !== undefined) onSpawn?.(child.pid);
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => {
      stdout.push(chunk);
      // A caller watching the command as it runs (the comparison's stall watch) sees each chunk
      // as it arrives; the whole output is still kept and recorded exactly as before.
      onStdout?.(chunk);
    });
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    if (input !== null) child.stdin.end(input);
    let timedOut = false;
    let interrupted = false;
    let killedAt = null;
    let confirmTimer = null;
    let finished = false;
    // Killing a docker client leaves its container running, so a named container is removed too.
    const container =
      argv[0] === "docker" && argv[1] === "run" ? argv[argv.indexOf("--name") + 1] : null;
    const killGroup = () => {
      if (killedAt !== null) return;
      killedAt = Date.now();
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      if (container) spawnSync("docker", ["rm", "-f", container], { stdio: "ignore" });
      if (killConfirmMs !== null)
        confirmTimer = setTimeout(() => finish(null, "SIGKILL", null, false), killConfirmMs);
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
    const finish = (exitCode, exitSignal, spawnError = null, confirmed = true) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(confirmTimer);
      signal?.removeEventListener("abort", onAbort);
      resolve({
        argv: [...argv],
        cwd,
        exitCode,
        signal: timedOut ? "SIGKILL(deadline)" : interrupted ? "SIGKILL(interrupted)" : exitSignal,
        wallMs: Date.now() - started,
        stdout: Buffer.concat(stdout),
        stderr: spawnError === null ? Buffer.concat(stderr) : Buffer.from(String(spawnError)),
        termination:
          killedAt === null ? null : { confirmed, ms: confirmed ? Date.now() - killedAt : null },
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

/**
 * A command log bound to one launch: run, record, and hand the result back. `defaults` apply to
 * every run; a default `signal` is combined with the caller's so that aborting either stops the
 * command, which is how one interruption reaches every child a launch owns.
 */
export function commandLog(blobDirectory, defaults = {}) {
  const commands = [];
  return {
    commands,
    /** The last kill this log performed, for a stop record's cleanup outcome. */
    lastTermination: null,
    async run(argv, options) {
      const signals = [defaults.signal, options.signal].filter(Boolean);
      const signal =
        signals.length === 0 ? null : signals.length === 1 ? signals[0] : AbortSignal.any(signals);
      const result = await runCommand(argv, { ...defaults, ...options, signal });
      commands.push(recordOf(result, blobDirectory));
      if (result.termination !== null) this.lastTermination = result.termination;
      return result;
    },
  };
}
