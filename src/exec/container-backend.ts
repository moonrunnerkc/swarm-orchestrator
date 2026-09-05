import { execFileSync } from "node:child_process";
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
  readonly network?: "none" | "bridge";
}

const workspaceMountPoint = "/workspace";

export function createContainerBackend(options: ContainerBackendOptions): IsolationBackend {
  return {
    name: `${options.runtime}:${options.image}`,
    nodeProgram: "node",
    run: (argv, runOptions) =>
      runProcessGroup(
        options.runtime,
        [
          "run",
          "--rm",
          // No network at all unless a run explicitly asked for one, which is an approval and
          // not a default: a command that can reach the internet can exfiltrate what it read.
          `--network=${options.network ?? "none"}`,
          // The image's own filesystem is read-only. Only the mounts below can be written.
          "--read-only",
          `--volume=${options.workspaceRoot}:${workspaceMountPoint}:rw`,
          // Somewhere to write that is not the workspace and does not survive the run.
          "--tmpfs=/tmp:rw,size=256m",
          `--workdir=${workspaceMountPoint}`,
          `--user=${options.user}`,
          "--cap-drop=ALL",
          // Stops a process gaining privileges through a setuid binary in the image.
          "--security-opt=no-new-privileges",
          `--memory=${options.memory ?? "2g"}`,
          `--pids-limit=${options.processLimit ?? 256}`,
          // A shell inside the container would re-read the arguments; there is none, and the
          // vector below is the process, argument for argument.
          "--entrypoint",
          argv[0] ?? "true",
          options.image,
          ...argv.slice(1),
        ],
        {
          cwd: runOptions.cwd,
          // The runtime client needs PATH and its own configuration directory to find the
          // daemon; nothing from here reaches the container, which gets the image's own.
          env: {
            PATH: process.env.PATH ?? "",
            ...(process.env.HOME === undefined ? {} : { HOME: process.env.HOME }),
          },
          timeoutMs: runOptions.timeoutMs,
          maxOutputBytes: 4_000_000,
        },
      ),
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
