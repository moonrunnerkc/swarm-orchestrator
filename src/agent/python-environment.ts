import { createHash } from "node:crypto";
import { access, appendFile, constants, lstat, readFile, realpath, rm } from "node:fs/promises";
import { delimiter, join, sep } from "node:path";
import { runProcessGroup } from "swarm-verify/execution";
import { z } from "zod";
import { declaredSetup, UnreadableSetupError } from "../config/declared-setup.ts";

/** The worktree's own Python environment, as the run built it or why it could not. */
export interface PythonEnvironment {
  readonly state: "prepared" | "not-prepared";
  /** The setup step run in the worktree; null where there was none to run. */
  readonly command: string | null;
  /** The interpreter the agent's commands get, inside the worktree, where it was prepared. */
  readonly interpreter: string | null;
  readonly version: string | null;
  readonly lockfile: { readonly path: "uv.lock"; readonly sha256: string } | null;
  /** Why the worktree has no environment and the step that would build one, where it has none. */
  readonly limitation: string | null;
}

const uvSync = "uv sync --frozen";
const lockThenSync = "uv lock && uv sync --frozen --all-extras";
const setupTimeoutMs = 600_000;

/**
 * What the worktree's interpreter says about itself. Paths are resolved through links on the
 * Python side, so they compare with the realpath of the worktree and the repository.
 */
const interpreterReport = z.object({
  prefix: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  path: z.array(z.string()),
});
const reportScript = `import json, os, sys
print(json.dumps({"prefix": os.path.realpath(sys.prefix), "version": "%d.%d.%d" % sys.version_info[:3], "path": [os.path.realpath(p) for p in sys.path if p]}))`;

export interface PythonEnvironmentInput {
  readonly worktree: string;
  /** The user's repository, which the worktree's environment must never import from. */
  readonly repository: string;
  /** The child environment the run's commands get; uv is found on its PATH. */
  readonly env: Readonly<Record<string, string>>;
  /** The run's wall deadline, epoch milliseconds; Infinity for none. */
  readonly deadline: number;
  readonly signal?: AbortSignal | undefined;
}

/**
 * Builds the worktree's `.venv` from the lockfile, in the worktree, rather than copying the
 * user's: a copy keeps the original interpreter in its console scripts and an editable install's
 * path to the user's source. The command is the repository's `[verify] setup` where it declares
 * one, `uv sync --frozen` for a uv.lock, and for a pyproject.toml with no lock `uv lock` first, as
 * the verifier prepares a checkout. Null where the project has neither a uv.lock nor a `.venv`.
 */
export async function preparePythonEnvironment(
  input: PythonEnvironmentInput,
): Promise<PythonEnvironment | null> {
  const lock = await readFile(join(input.worktree, "uv.lock")).catch(() => null);
  const lockfile =
    lock === null
      ? null
      : { path: "uv.lock" as const, sha256: createHash("sha256").update(lock).digest("hex") };
  const userVenv = await lstat(join(input.repository, ".venv")).then(
    () => true,
    () => false,
  );
  if (lockfile === null && !userVenv) return null;
  const unprepared = (command: string | null, limitation: string): PythonEnvironment => ({
    state: "not-prepared",
    command,
    interpreter: null,
    version: null,
    lockfile,
    limitation,
  });

  let setup: string | null;
  try {
    setup = await declaredSetup(input.worktree);
  } catch (error) {
    if (!(error instanceof UnreadableSetupError)) throw error;
    return unprepared(null, `${error.message}; the agent's commands ran without a .venv`);
  }
  // Without a uv.lock, the verifier resolves one first; the run's environment is made the same way.
  const pyproject = await access(join(input.worktree, "pyproject.toml")).then(
    () => true,
    () => false,
  );
  const command = setup ?? (lockfile !== null ? uvSync : pyproject ? lockThenSync : null);
  if (command === null) {
    return unprepared(
      null,
      "the workspace has a .venv, but no uv.lock and no [verify] setup in swarm.toml to build the worktree's own from; the agent's commands ran without one. Add a uv.lock (`uv lock`) or declare the setup command",
    );
  }
  let program: { readonly file: string; readonly args: readonly string[] };
  if (setup === null) {
    const uv = await onPath("uv", input.env.PATH ?? "");
    if (uv === null) {
      return unprepared(
        command,
        `uv is not on PATH, so \`${command}\` could not build the worktree's .venv; the agent's commands ran without one. Install uv (https://docs.astral.sh/uv/) and run again`,
      );
    }
    program =
      lockfile !== null
        ? { file: uv, args: ["sync", "--frozen"] }
        : { file: "/bin/sh", args: ["-c", `"$0" lock && "$0" sync --frozen --all-extras`, uv] };
  } else {
    program = { file: "/bin/sh", args: ["-c", setup] };
  }

  // A lock resolved here is the run's, not the change: the clone's own exclude file keeps it out.
  if (lockfile === null && setup === null) {
    await appendFile(join(input.worktree, ".git", "info", "exclude"), "/uv.lock\n");
  }
  const options = {
    cwd: input.worktree,
    env: { ...input.env },
    maxOutputBytes: 1024 * 1024,
    signal: input.signal,
  };
  const ran = await runProcessGroup(program.file, program.args, {
    ...options,
    timeoutMs: Math.min(setupTimeoutMs, input.deadline - Date.now()),
  });
  const venv = join(input.worktree, ".venv");
  // A half-built environment is worse than none: the agent would trust what it imports.
  const discard = async (limitation: string) => {
    await rm(venv, { recursive: true, force: true });
    return unprepared(command, limitation);
  };
  if (ran.startFailure !== null || ran.timedOut || ran.cancelled || ran.exitCode !== 0) {
    const how =
      ran.startFailure ??
      (ran.timedOut
        ? "it timed out"
        : ran.cancelled
          ? "the run was cancelled"
          : `exit ${ran.exitCode}: ${lastLine(ran.stderr || ran.stdout)}`);
    return discard(
      `\`${command}\` failed in the worktree (${how}); the agent's commands ran without a .venv. Run it in the repository to see why`,
    );
  }

  const interpreter = join(venv, "bin", "python");
  const probed = await runProcessGroup(interpreter, ["-c", reportScript], {
    ...options,
    timeoutMs: 60_000,
  });
  const parsed =
    probed.exitCode === 0 ? interpreterReport.safeParse(parseJson(probed.stdout)) : null;
  if (parsed?.success !== true) {
    return discard(
      `\`${command}\` left no working .venv/bin/python in the worktree; the agent's commands ran without one. Make the setup create .venv in the repository's root`,
    );
  }
  const own = await realpath(venv);
  const repository = `${await realpath(input.repository)}${sep}`;
  if (parsed.data.prefix !== own) {
    return discard(
      `the .venv \`${command}\` built is not the worktree's own (its prefix is ${parsed.data.prefix}); the agent's commands ran without it. Make the setup create .venv in the directory it runs in`,
    );
  }
  const reached = parsed.data.path.find((entry) => `${entry}${sep}`.startsWith(repository));
  if (reached !== undefined) {
    return discard(
      `the .venv \`${command}\` built imports from the user's tree (${reached}); the agent's commands ran without it. Make the setup install the project from the directory it runs in`,
    );
  }
  return {
    state: "prepared",
    command,
    interpreter,
    version: parsed.data.version,
    lockfile,
    limitation: null,
  };
}

/** One line for the report: what the agent's Python was, or why it had none. */
export function describePythonEnvironment(environment: PythonEnvironment): string {
  if (environment.state === "not-prepared") return `not prepared, ${environment.limitation}`;
  const from =
    environment.lockfile === null ? "" : ` from uv.lock (sha256 ${environment.lockfile.sha256})`;
  return `built in the worktree by \`${environment.command}\`${from}; interpreter ${environment.interpreter}, Python ${environment.version}`;
}

async function onPath(name: string, path: string): Promise<string | null> {
  for (const directory of path.split(delimiter)) {
    if (directory.length === 0) continue;
    const candidate = join(directory, name);
    if (
      await access(candidate, constants.X_OK).then(
        () => true,
        () => false,
      )
    )
      return candidate;
  }
  return null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function lastLine(output: string): string {
  const lines = output.trim().split("\n");
  return (lines.at(-1) ?? "").trim().slice(0, 300);
}
