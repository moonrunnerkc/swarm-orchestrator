import { execFile } from "node:child_process";
import { access, rm } from "node:fs/promises";
import { join } from "node:path";
import { snapshotWorkingTree } from "swarm-verify";
import { gitText } from "./git.ts";

/** The user's tree as the run found it: HEAD plus every edit, staged, unstaged or untracked. */
export interface StartingState {
  readonly head: string;
  /** The commit in the managed worktree that holds that state; the run's base. */
  readonly base: string;
  readonly patch: string;
  readonly patchSha256: string;
  /** The paths the user's own edits touched, the boundary between their work and the run's. */
  readonly paths: readonly string[];
}

export interface ManagedWorkspace {
  readonly directory: string;
  readonly start: StartingState;
  remove(): Promise<void>;
}

const run = (command: string, args: readonly string[], cwd: string) =>
  new Promise<void>((settle, fail) => {
    execFile(command, [...args], { cwd, maxBuffer: 64 * 1024 * 1024 }, (error, _stdout, stderr) =>
      error === null
        ? settle()
        : fail(new Error(`${command} ${args.join(" ")} failed: ${stderr.trim() || error.message}`)),
    );
  });

/**
 * node_modules is copied, copy-on-write where the filesystem allows; the links npm makes there are
 * relative, so a workspace package resolves inside the copy. A .venv is never copied: it is built
 * in the worktree from its lockfile (python-environment.ts), since a copy runs through the original
 * environment.
 */
const installed = ["node_modules"];

/**
 * A detached git worktree of HEAD outside the user's tree, with the user's uncommitted edits
 * applied and committed there as the run's base, and a copy of the installed node_modules.
 * Nothing in the user's working tree, index or branches changes.
 */
export async function openWorkspace(
  repository: string,
  directory: string,
  scratch: string,
): Promise<ManagedWorkspace> {
  const head = await gitText(repository, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const edits = await snapshotWorkingTree(repository, head, join(scratch, "starting-state.patch"));
  await run("git", ["worktree", "add", "--quiet", "--detach", directory, head], repository);
  const paths: string[] = [];
  let base = head;
  if (
    (await gitText(repository, ["diff", "--stat", "--no-color", head, "--", "."]).catch(
      () => "",
    )) !== "" ||
    edits.sha256 !== emptySha256
  ) {
    const listed = await gitText(directory, ["apply", "--numstat", edits.path]).catch(() => "");
    for (const line of listed.split("\n")) {
      const path = line.split("\t")[2];
      if (path !== undefined && path.length > 0) paths.push(path);
    }
    if (paths.length > 0) {
      await run("git", ["apply", "--index", "--whitespace=nowarn", edits.path], directory);
      await run(
        "git",
        [
          "-c",
          "user.name=swarm",
          "-c",
          "user.email=swarm@localhost",
          "commit",
          "--quiet",
          "--no-verify",
          "-m",
          "The starting state swarm run found",
        ],
        directory,
      );
      base = await gitText(directory, ["rev-parse", "HEAD"]);
    }
  }
  for (const name of installed) {
    const source = join(repository, name);
    if (
      await access(source).then(
        () => true,
        () => false,
      )
    ) {
      await run(
        "cp",
        process.platform === "darwin"
          ? ["-c", "-R", source, join(directory, name)]
          : ["-R", "--reflink=auto", source, join(directory, name)],
        repository,
      );
    }
  }
  return {
    directory,
    start: { head, base, patch: edits.path, patchSha256: edits.sha256, paths },
    remove: async () => {
      await run("git", ["worktree", "remove", "--force", directory], repository).catch(() =>
        rm(directory, { recursive: true, force: true }),
      );
      await run("git", ["worktree", "prune"], repository);
    },
  };
}

/** sha256 of no bytes: the patch of a working tree with no edits. */
const emptySha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export type Delivery =
  | { readonly applied: true }
  | { readonly applied: false; readonly reason: string };

/**
 * The delivered patch applied to the user's working tree, only where that tree is still exactly
 * the starting state the run began from. The index is left as the user had it.
 */
export async function deliver(
  repository: string,
  start: StartingState,
  patch: string,
  scratch: string,
): Promise<Delivery> {
  const now = await snapshotWorkingTree(
    repository,
    start.head,
    join(scratch, "target-check.patch"),
  );
  const head = await gitText(repository, ["rev-parse", "--verify", "HEAD^{commit}"]);
  if (head !== start.head || now.sha256 !== start.patchSha256) {
    return {
      applied: false,
      reason: `the workspace changed during the run; apply it yourself with \`git apply ${patch}\``,
    };
  }
  try {
    await run("git", ["apply", "--whitespace=nowarn", patch], repository);
    return { applied: true };
  } catch (error) {
    return {
      applied: false,
      reason: `git apply refused it: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
