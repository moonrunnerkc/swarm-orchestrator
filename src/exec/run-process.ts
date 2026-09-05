import { spawn } from "node:child_process";

/**
 * A process the harness can still stop after it has started something of its own.
 *
 * `execFile`'s timeout signals the process it started and nothing else. A test runner that
 * forks workers, a dev server, a build that shells out: each leaves its children running after
 * the harness has given up on the parent, and those children keep writing into the workspace a
 * gate is about to read. The fix is a process group: the child leads one, and the signal goes
 * to the group.
 */
export interface ProcessRunOptions {
  readonly cwd: string;
  /** Built rather than inherited. Nothing here reads `process.env`. */
  readonly env: Record<string, string>;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  /** Cancellation from the run's own tree: a deadline, a Ctrl-C, a policy stop. */
  readonly signal?: AbortSignal | undefined;
  /** How long the group gets to exit on SIGTERM before SIGKILL. */
  readonly killGraceMs?: number | undefined;
}

export interface ProcessRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  /** Output stopped at the ceiling, so what is here is a prefix rather than the whole. */
  readonly truncated: boolean;
  /** Why the program never started, where it never did. Distinct from an exit code. */
  readonly startFailure: string | null;
}

/** The shell's own answer for a program it could not find. */
const notFoundExitCode = 127;
const defaultKillGraceMs = 2_000;

export function runProcessGroup(
  file: string,
  args: readonly string[],
  options: ProcessRunOptions,
): Promise<ProcessRunResult> {
  return new Promise((settle) => {
    const child = spawn(file, [...args], {
      cwd: options.cwd,
      env: options.env,
      // Its own process group, so one signal reaches everything it started.
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const collect = (into: "out" | "err") => (chunk: Buffer) => {
      const held = into === "out" ? stdout.length : stderr.length;
      const room = options.maxOutputBytes - held;
      if (room <= 0) {
        truncated = true;
        return;
      }
      const text = chunk.toString("utf8");
      const kept = text.length > room ? text.slice(0, room) : text;
      truncated ||= kept.length < text.length;
      if (into === "out") {
        stdout += kept;
      } else {
        stderr += kept;
      }
    };

    child.stdout?.on("data", collect("out"));
    child.stderr?.on("data", collect("err"));

    const stopGroup = () => {
      signalGroup(child.pid, "SIGTERM");
      const escalation = setTimeout(
        () => signalGroup(child.pid, "SIGKILL"),
        options.killGraceMs ?? defaultKillGraceMs,
      );
      escalation.unref();
    };

    const deadline = setTimeout(() => {
      timedOut = true;
      stopGroup();
    }, options.timeoutMs);

    const onCancel = () => {
      cancelled = true;
      stopGroup();
    };
    options.signal?.addEventListener("abort", onCancel, { once: true });

    const finish = (result: ProcessRunResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      options.signal?.removeEventListener("abort", onCancel);
      settle(result);
    };

    child.on("error", (cause: NodeJS.ErrnoException) => {
      finish({
        stdout,
        stderr,
        exitCode: notFoundExitCode,
        timedOut,
        cancelled,
        truncated,
        startFailure: `${file} could not be started (${cause.code ?? cause.message})`,
      });
    });

    child.on("close", (code, signalName) => {
      finish({
        stdout,
        stderr,
        // A process killed by a signal reports no code. It ran and it did not pass, which is a
        // failure of whatever was measuring it rather than an absence of measurement.
        exitCode: code ?? (signalName === null ? 1 : 128),
        timedOut,
        cancelled,
        truncated,
        startFailure: null,
      });
    });
  });
}

/**
 * Signals the group rather than the process. ESRCH means the group is already gone, which is
 * the ordinary case for a command that exited between the deadline firing and the signal.
 */
function signalGroup(pid: number | undefined, signalName: NodeJS.Signals): void {
  if (pid === undefined) {
    return;
  }
  try {
    process.kill(-pid, signalName);
  } catch {
    try {
      process.kill(pid, signalName);
    } catch {
      // Already gone.
    }
  }
}
