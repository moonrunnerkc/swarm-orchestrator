import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const runProcess = promisify(execFile);

/**
 * Git operations taken through an index of our own, so the person's stays where they left it.
 *
 * Two things here need the whole working tree staged against some base, and neither may touch
 * the index somebody is using: measuring what changed since a base, and writing a commit object
 * that names the tree as it stands. Doing that through a temporary index is what makes both
 * safe, and it is also what makes untracked files count. They have to count: a file the agent
 * has just written is the ordinary case, and `git diff <base>` from the real index calls such a
 * file *deleted*, because it is in the base commit and absent from that index. A session then
 * measures its second turn as two deletions with nothing added, which is how a turn that wrote
 * a test came to report `0 added line(s)`.
 */

export interface ScratchIndexOptions {
  readonly workspaceRoot: string;
  readonly baseRef: string;
}

/** The environment is built rather than inherited: a stray GIT_INDEX_FILE or GIT_DIR would aim these at another tree. */
export function gitEnvironment(extra: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    ...extra,
  };
}

export async function runGit(
  root: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  const { stdout } = await runProcess("git", [...args], {
    cwd: root,
    env: environment,
    maxBuffer: 64_000_000,
  });
  return stdout;
}

/**
 * Stages the whole tree against `baseRef` in a throwaway index and hands the caller a way to
 * run git against it. The index is removed afterwards whatever happens.
 */
export async function withScratchIndex<T>(
  options: ScratchIndexOptions,
  use: (git: (args: readonly string[]) => Promise<string>) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "swarm-scratch-index-"));
  const environment = gitEnvironment({ GIT_INDEX_FILE: join(directory, "index") });
  const git = (args: readonly string[]) => runGit(options.workspaceRoot, args, environment);

  try {
    // read-tree first: without it `add -A` has nothing to compare against and every path in
    // the tree reads as added, which would make the first measurement of a session enormous.
    await git(["read-tree", options.baseRef]);
    await git(["add", "-A"]);
    return await use(git);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Everything that differs between `baseRef` and the working tree, untracked files included, as
 * a unified diff. `--cached` is what makes it read the staged scratch index rather than the
 * person's, and the comparison is therefore tree to tree rather than commit to index.
 */
export async function diffAgainstBase(options: ScratchIndexOptions): Promise<string> {
  return withScratchIndex(options, (git) =>
    git(["diff", "--no-color", "--no-ext-diff", "--unified=0", "--cached", options.baseRef, "--"]),
  );
}
