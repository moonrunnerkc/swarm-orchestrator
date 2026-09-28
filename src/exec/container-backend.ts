import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { overlaidEnvironment } from "./child-environment.ts";
import { containerImageSchema } from "./container-image.ts";
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
    phase: "create-intent" | "created" | "removed" | "cleanup-failed";
  }) => Promise<void>;
  readonly runProcess?: typeof runProcessGroup;
  /** The pause before a second and third image pull; tests pass 0. */
  readonly pullRetryPauseMs?: number;
  /** The pause before a second and third removal round; tests set it to 0. */
  readonly cleanupRetryPauseMs?: number;
}

const workspaceMountPoint = "/workspace";

/**
 * Where a run's scratch directory lives on the host: under the person's home, which a desktop
 * container runtime shares with containers where the system temporary directory is not, and
 * outside every workspace.
 */
export function scratchRoot(): string {
  return join(homedir(), ".swarm", "scratch");
}
const environmentNames = ["LANG", "TZ", "PLAYWRIGHT_BROWSERS_PATH"] as const;

export function createContainerBackend(options: ContainerBackendOptions): IsolationBackend {
  containerImageSchema.parse(options.image);
  // The image is made present once per backend, before the first container is created. A
  // `create` against an absent image pulls it inside the command's own deadline, and a probe's
  // deadline is seconds, so on a fresh machine every container would time out while the image
  // downloaded and the run would stop without saying why.
  let imageReady: Promise<void> | null = null;
  const ensureImage = (execute: typeof runProcessGroup, cwd: string): Promise<void> => {
    imageReady ??= (async () => {
      const runtimeOptions = { cwd, env: containerClientEnvironment(), maxOutputBytes: 1_000_000 };
      const present = await execute(
        options.runtime,
        ["image", "inspect", "--format", "{{.Id}}", options.image],
        { ...runtimeOptions, timeoutMs: 15_000 },
      );
      if (present.exitCode === 0) return;
      // A registry drops connections now and then (a hosted runner saw "connection reset by
      // peer" from Docker Hub); three attempts with a pause between them, and the last
      // failure's own line is what the error names.
      let pulled = await execute(options.runtime, ["pull", "--quiet", options.image], {
        ...runtimeOptions,
        timeoutMs: 600_000,
      });
      for (
        let attempt = 2;
        attempt <= 3 && pulled.exitCode !== 0 && !pulled.timedOut;
        attempt += 1
      ) {
        await new Promise((resolve) =>
          setTimeout(resolve, (options.pullRetryPauseMs ?? 15_000) * (attempt - 1)),
        );
        pulled = await execute(options.runtime, ["pull", "--quiet", options.image], {
          ...runtimeOptions,
          timeoutMs: 600_000,
        });
      }
      if (pulled.exitCode !== 0) {
        imageReady = null;
        throw new Error(
          `image ${options.image} is not present and could not be pulled${pulled.timedOut ? " within ten minutes" : " in three attempts"}: ${(pulled.stderr || pulled.startFailure || "").trim().split("\n").at(-1) ?? ""}`,
        );
      }
    })();
    return imageReady;
  };
  return {
    name: `${options.runtime}:${options.image}`,
    nodeProgram: "node",
    protectsReadOnlyFiles: true,
    immutableRuntime: true,
    environmentNames,
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
      const overlay = runOptions.environment ?? {};
      if (
        Object.keys(overlay).some((name) => !(environmentNames as readonly string[]).includes(name))
      )
        throw new Error("container backend does not support the requested environment overlay");
      const variables = overlaidEnvironment(
        {
          PATH: "/usr/local/bin:/usr/bin:/bin",
          HOME: "/tmp",
          TMPDIR: "/tmp",
          COREPACK_ENABLE_NETWORK: "0",
          COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
          COREPACK_ENABLE_AUTO_PIN: "0",
          UV_PYTHON_DOWNLOADS: "never",
        },
        overlay,
      );
      const readOnlyMounts: string[] = [];
      for (const file of runOptions.readOnlyFiles ?? []) {
        const path = relative(options.workspaceRoot, file);
        if (
          path.startsWith("..") ||
          isAbsolute(path) ||
          /[:,\r\n]/.test(file) ||
          !(await lstat(file)).isFile() ||
          (await realpath(file)) !== file
        )
          throw new Error("read-only acceptance file must be an ordinary file inside the checkout");
        readOnlyMounts.push(`--volume=${file}:${workspaceMountPoint}/${path}:ro`);
      }
      // The image is made present before the command's deadline starts, so a pull that takes
      // longer than a probe's allowance leaves the probe its whole allowance.
      await ensureImage(execute, options.workspaceRoot);
      const deadline = Date.now() + runOptions.timeoutMs;
      const identity = `swarm-${randomUUID()}`;
      const scratch = join(scratchRoot(), identity);
      const runtimeOptions = {
        cwd: options.workspaceRoot,
        env: containerClientEnvironment(),
        timeoutMs: 15_000,
        maxOutputBytes: 4_000_000,
      };
      await options.observeLifecycle?.({ identity, phase: "create-intent" });
      let ran: Awaited<ReturnType<typeof runProcessGroup>>;
      let cleanupFailure: Error | null = null;
      let creationUncertain = false;
      let createdTimedOut = false;
      let createdStderr = "";
      try {
        // Created inside the try, so every exit from here passes the removal below.
        await mkdir(scratch, { recursive: true, mode: 0o700 });
        const created = await execute(
          options.runtime,
          [
            "create",
            ...(runOptions.stdin === undefined ? [] : ["--interactive"]),
            `--name=${identity}`,
            "--label=dev.swarm.runtime=true",
            ...(options.sessionId === undefined
              ? []
              : [`--label=dev.swarm.session=${options.sessionId}`]),
            // A command that asked for the registry gets the bridge for its own run only; the
            // backend's default stays none, and nothing reads a previous command's setting.
            `--network=${runOptions.network === "registry" ? "bridge" : (options.network ?? "none")}`,
            "--read-only",
            `--volume=${options.workspaceRoot}:${workspaceMountPoint}:rw`,
            ...readOnlyMounts,
            // The scratch space is a directory on the host, mounted at /tmp, not a tmpfs: HOME
            // and TMPDIR inside the container are here, so npm's and uv's caches are too, and
            // a tmpfs is charged to the container's memory limit, which killed every large
            // install (exit 137) once the cache passed the 2 GB cap. It is owned by this run,
            // executable (a fetched package manager unpacks and runs here), and removed after.
            `--volume=${scratch}:/tmp:rw`,
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
            ...Object.entries(variables).map(([name, value]) => `${name}=${value}`),
            ...argv.map((argument, index) =>
              index === 0 && argument === process.execPath ? "node" : argument,
            ),
          ],
          { ...runtimeOptions, timeoutMs: runOptions.timeoutMs },
        );
        creationUncertain = created.timedOut || created.startFailure !== null;
        createdTimedOut = created.timedOut;
        createdStderr = (created.startFailure ?? created.stderr).trim().split("\n").at(-1) ?? "";
        if (created.exitCode === 0)
          await options.observeLifecycle?.({ identity, phase: "created" });
        ran =
          created.exitCode === 0
            ? await execute(
                options.runtime,
                [
                  "start",
                  "--attach",
                  ...(runOptions.stdin === undefined ? [] : ["--interactive"]),
                  identity,
                ],
                {
                  ...runtimeOptions,
                  timeoutMs: Math.max(0, deadline - Date.now()),
                  signal: runOptions.signal,
                  ...(runOptions.stdin === undefined ? {} : { stdin: runOptions.stdin }),
                  maxOutputBytes: runOptions.maxOutputBytes ?? runtimeOptions.maxOutputBytes,
                },
              )
            : created;
      } finally {
        // Removal is asked for and then observed, up to three times with a growing pause. One
        // sample was too few: under load the runtime finished removals after its 15-second
        // client deadline, so a container gone moments later refused twelve study rows in a
        // row. A container still listed after the last round, or one whose creation was
        // uncertain, is still an unconfirmed cleanup.
        let removed = false;
        try {
          for (let round = 1; round <= 3 && !removed; round += 1) {
            if (round > 1)
              await new Promise((resolve) =>
                setTimeout(resolve, (options.cleanupRetryPauseMs ?? 5_000) * (round - 1)),
              );
            await execute(options.runtime, ["rm", "--force", identity], runtimeOptions);
            const inspected = await execute(
              options.runtime,
              ["ps", "--all", "--quiet", "--filter", `name=^/${identity}$`],
              runtimeOptions,
            );
            removed = inspected.exitCode === 0 && inspected.stdout.trim() === "";
            if (creationUncertain) break;
          }
        } finally {
          // The scratch directory goes whatever the runtime's removal did or threw.
          await rm(scratch, { recursive: true, force: true });
        }
        removed = removed && !creationUncertain;
        await options.observeLifecycle?.({
          identity,
          phase: removed ? "removed" : "cleanup-failed",
        });
        if (!removed) {
          // Name what creation observed, so a create that timed out or failed to start is not
          // reported only as a cleanup that could not be confirmed.
          const creation = creationUncertain
            ? ` (creation ${createdTimedOut ? "timed out" : "did not start"}${createdStderr ? `: ${createdStderr}` : ""})`
            : "";
          cleanupFailure = new Error(
            `container ${identity} cleanup could not be confirmed${creation}; stop dispatch and repair this runtime resource`,
          );
        }
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
