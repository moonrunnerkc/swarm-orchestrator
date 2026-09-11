import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isAbsolute, relative } from "node:path";
import type { IsolationBackend } from "./execution-mode.ts";
import { runProcessGroup } from "./run-process.ts";

/**
 * A kernel-enforced boundary, which is what `isolated` means and what a lexical path and
 * program policy is not. The workspace is the only thing mounted, nothing else on the host is
 * reachable, the network is off, and the process runs unprivileged with every capability
 * dropped and its memory, process count and filesystem writes bounded.
 *
 * Whether all of that holds is not asserted here: the containment self-test runs the escapes
 * against this backend and reports what got through, and the mode comes from that result.
 */
export interface ContainerBackendOptions {
  /** `docker`, `podman`, or anything else that speaks the same run interface. */
  readonly runtime: string;
  readonly image: string;
  /** Mounted read-write at /workspace. The only path from the host the command can see. */
  readonly workspaceRoot: string;
  /** `uid:gid`, so files the command writes belong to the person who started the run. */
  readonly user: string;
  readonly memory?: string;
  readonly processLimit?: number;
  readonly sessionId?: string;
  readonly network?: "none" | "bridge";
  readonly observeLifecycle?: (event: {
    identity: string;
    phase: "created" | "removed" | "cleanup-failed";
  }) => Promise<void>;
  readonly runProcess?: typeof runProcessGroup;
}

const workspaceMountPoint = "/workspace";

export function createContainerBackend(options: ContainerBackendOptions): IsolationBackend {
  return {
    name: `${options.runtime}:${options.image}`,
    nodeProgram: "node",
    run: async (argv, runOptions) => {
      const execute = options.runProcess ?? runProcessGroup;
      const subdirectory = relative(options.workspaceRoot, runOptions.cwd);
      if (subdirectory.startsWith("..") || isAbsolute(subdirectory)) {
        return {
          stdout: "",
          stderr: "",
          exitCode: 127,
          timedOut: false,
          cancelled: false,
          truncated: false,
          startFailure:
            "requested directory is outside the backend workspace; create a backend for this checkout",
        };
      }
      if (runOptions.signal?.aborted) {
        return {
          stdout: "",
          stderr: "cancelled before container creation",
          exitCode: 128,
          timedOut: false,
          cancelled: true,
          truncated: false,
          startFailure: null,
        };
      }
      const deadline = Date.now() + runOptions.timeoutMs;
      const identity = `swarm-${randomUUID()}`;
      const runtimeOptions = {
        cwd: options.workspaceRoot,
        env: containerClientEnvironment(),
        timeoutMs: 15_000,
        maxOutputBytes: 4_000_000,
      };
      await options.observeLifecycle?.({ identity, phase: "created" });
      let ran: Awaited<ReturnType<typeof runProcessGroup>>;
      let cleanupFailure: Error | null = null;
      let creationUncertain = false;
      try {
        const created = await execute(
          options.runtime,
          [
            "create",
            `--name=${identity}`,
            "--label=dev.swarm.runtime=true",
            ...(options.sessionId === undefined
              ? []
              : [`--label=dev.swarm.session=${options.sessionId}`]),
            `--network=${options.network ?? "none"}`,
            "--read-only",
            `--volume=${options.workspaceRoot}:${workspaceMountPoint}:rw`,
            "--tmpfs=/tmp:rw,size=256m",
            `--workdir=${workspaceMountPoint}${subdirectory ? `/${subdirectory}` : ""}`,
            `--user=${options.user}`,
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            `--memory=${options.memory ?? "2g"}`,
            `--pids-limit=${options.processLimit ?? 256}`,
            "--entrypoint",
            "/usr/bin/env",
            options.image,
            "-i",
            "PATH=/usr/local/bin:/usr/bin:/bin",
            "HOME=/tmp",
            "TMPDIR=/tmp",
            ...argv.map((argument, index) =>
              index === 0 && argument === process.execPath ? "node" : argument,
            ),
          ],
          { ...runtimeOptions, timeoutMs: runOptions.timeoutMs },
        );
        creationUncertain = created.timedOut || created.startFailure !== null;
        ran =
          created.exitCode === 0
            ? await execute(options.runtime, ["start", "--attach", identity], {
                ...runtimeOptions,
                timeoutMs: Math.max(0, deadline - Date.now()),
                signal: runOptions.signal,
              })
            : created;
      } finally {
        await execute(options.runtime, ["rm", "--force", identity], runtimeOptions);
        const inspected = await execute(
          options.runtime,
          ["ps", "--all", "--quiet", "--filter", `name=^/${identity}$`],
          runtimeOptions,
        );
        const removed =
          !creationUncertain && inspected.exitCode === 0 && inspected.stdout.trim() === "";
        await options.observeLifecycle?.({
          identity,
          phase: removed ? "removed" : "cleanup-failed",
        });
        if (!removed)
          cleanupFailure = new Error(
            `container ${identity} cleanup could not be confirmed; stop dispatch and repair this runtime resource`,
          );
      }
      if (cleanupFailure !== null) throw cleanupFailure;
      return ran;
    },
  };
}

/** Whether the runtime is installed and answering, checked once rather than at the first run. */
export function containerRuntimeAvailable(runtime: string): boolean {
  try {
    execFileSync(runtime, ["version", "--format", "{{.Server.Version}}"], {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

/** Runtime administration may read its own configuration; workspace children receive a separate environment. */
export function containerClientEnvironment(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    ...(process.env.HOME === undefined ? {} : { HOME: process.env.HOME }),
  };
}
