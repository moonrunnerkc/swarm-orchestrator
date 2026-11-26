import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { declaredChecks } from "swarm-verify";
import {
  openWorker,
  type ProcessRunResult,
  type ResourceRecord,
  runProcessGroup,
} from "swarm-verify/execution";
import { readShellCommand } from "./shell-command.ts";

type Ran = ProcessRunResult & { readonly exhausted?: string | null };

interface RunOptions {
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly signal?: AbortSignal | undefined;
  /** Open the network for a package manager fetching what a manifest names. */
  readonly network?: "dependencies";
}

/**
 * Where every command of a run executes: the model's, and the harness's own checks, which run
 * the candidate's code too. One per run, so there is no second route with a weaker boundary.
 */
export interface Executor {
  readonly mode: "isolated" | "host";
  /** The boundary in a line, for the report. */
  readonly statement: string;
  /** The image and the bounds read back from it; null on the host, which nothing bounds. */
  readonly container: { readonly image: string; readonly resources: ResourceRecord } | null;
  run(command: string, options: RunOptions): Promise<Ran>;
}

/** This machine, as the user: chosen with --host, and reported as not isolated. */
export function hostExecutor(cwd: string, env: Record<string, string>): Executor {
  return {
    mode: "host",
    statement:
      "host, not isolated: commands ran on this machine as its user, under the path policy alone",
    container: null,
    run: (command, options) =>
      runProcessGroup("/bin/sh", ["-c", command], {
        cwd,
        env,
        timeoutMs: options.timeoutMs,
        maxOutputBytes: options.maxOutputBytes,
        signal: options.signal,
      }),
  };
}

/** Runs nothing: what a run holds when its container could not be made, in place of the host. */
export function refusingExecutor(why: string): Executor {
  return {
    mode: "isolated",
    statement: `nothing ran: ${why}`,
    container: null,
    run: async () => ({
      stdout: "",
      stderr: "",
      exitCode: 1,
      timedOut: false,
      cancelled: false,
      truncated: false,
      startFailure: why,
    }),
  };
}

/** Package managers told to fetch without running what they fetch, while the network is open. */
const fetchOnly = {
  npm_config_ignore_scripts: "true",
  YARN_ENABLE_SCRIPTS: "false",
  PIP_ONLY_BINARY: ":all:",
};

const installers =
  /^(?:corepack\s+)?(?:npm\s+(?:ci|install|i|add|update)|pnpm\s+(?:install|i|add|update)|yarn(?:\s+(?:install|add))?|pip3?\s+install|python3?\s+-m\s+pip\s+install|uv\s+(?:sync|lock|add|pip\s+install))(?:\s|$)/;

/**
 * Whether a command is one package manager's install and nothing else: the one kind of command
 * the network is opened for. Anything joined to it would run with the network open too, so a
 * command that does more is not one.
 */
export function isDependencyInstall(command: string): boolean {
  const text = command.trim();
  const read = readShellCommand(text);
  return read !== null && read.executables.length === 1 && installers.test(text);
}

/** The object directories a clone borrows from, which its git needs to read. */
async function alternates(workspace: string): Promise<string[]> {
  const text = await readFile(
    join(workspace, ".git", "objects", "info", "alternates"),
    "utf8",
  ).catch(() => "");
  return text.split("\n").filter((line) => line.startsWith("/"));
}

const copied = (from: string, to: string) =>
  new Promise<void>((settle, fail) => {
    execFile("cp", ["-R", from, to], (error, _stdout, stderr) =>
      error === null ? settle() : fail(new Error(`copying ${from} failed: ${stderr.trim()}`)),
    );
  });

/**
 * A container per command, from the verifier's own sandbox: the workspace and a private HOME
 * writable, no network, bounded memory, CPU and processes, and nothing else of this machine. The
 * commands get a copy of the workspace's git directory in place of it, so git works for them and
 * a hook or config they write there is never read by this process's own git. `unavailable` says why there is none; the caller
 * stops, and never runs on the host instead.
 */
export async function containedExecutor(input: {
  readonly workspace: string;
  readonly home: string;
  readonly cache: string;
  readonly accounts: string;
  /** Where the commands' copy of the git directory is made; outside the workspace. */
  readonly gitCopy: string;
}): Promise<Executor | { readonly unavailable: string }> {
  const git = join(input.workspace, ".git");
  await copied(git, input.gitCopy);
  const worker = await openWorker({
    workspace: input.workspace,
    home: input.home,
    readOnly: await alternates(input.workspace),
    standIns: [{ src: input.gitCopy, dst: git }],
    // The image the verifier would choose for the same project.
    commands: (await declaredChecks(input.workspace)).map((check) => check.command),
    cache: input.cache,
    accounts: input.accounts,
  });
  if ("unavailable" in worker) return worker;
  return {
    mode: "isolated",
    statement: `isolated: each command in a container of ${worker.image}, network closed, only the workspace writable`,
    container: { image: worker.image, resources: worker.resources },
    run: (command, options) =>
      worker.run(command, {
        timeoutMs: options.timeoutMs,
        maxOutputBytes: options.maxOutputBytes,
        signal: options.signal,
        ...(options.network === undefined
          ? {}
          : { network: "dependencies" as const, env: fetchOnly }),
      }),
  };
}
