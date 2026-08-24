import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { firstGitDiagnostic } from "./git-workspace.ts";

const runProcess = promisify(execFile);

/**
 * A commit object naming the tree as it stands right now, so the next turn is measured against
 * the end of this one rather than against where the session started.
 *
 * A session runs several tasks against one working tree and nothing commits between them, so
 * with the base left at HEAD the second turn's gates measure both turns at once: the diff
 * budget accumulates, the file-set check sees the first turn's files as out-of-set, and the
 * comparison against base judges work the turn did not do.
 *
 * Written through a temporary index, which is the part that matters. `git stash create` is the
 * obvious way to get a commit object for a dirty tree and it is the wrong one here, because it
 * leaves untracked files out, and a file the agent has just created is the ordinary case rather
 * than the exotic one. A temporary index takes `add -A` over the whole tree without touching
 * the index the person is using, and `commit-tree` writes the object without moving HEAD.
 *
 * Nothing here changes what the user would see: HEAD, the working tree, and the real index are
 * all untouched, and the object is unreachable from any ref until something names it.
 */
export class TurnBaselineError extends Error {
  constructor(workspaceRoot: string, cause: unknown) {
    super(
      `could not record where this turn ended in ${workspaceRoot}: ${firstGitDiagnostic(cause)}. ` +
        "The next turn would then be measured against the start of the session rather than " +
        "against this turn, so the session stops here rather than reporting a diff that " +
        "belongs to work already finished.",
    );
    this.name = "TurnBaselineError";
  }
}

/**
 * Identity for the object, so writing one never depends on the person having configured git.
 * A baseline commit is harness bookkeeping and is never pushed, so naming the harness in it is
 * more honest than borrowing whoever happens to be configured.
 */
const baselineIdentity = {
  GIT_AUTHOR_NAME: "swarm",
  GIT_AUTHOR_EMAIL: "swarm@localhost",
  GIT_COMMITTER_NAME: "swarm",
  GIT_COMMITTER_EMAIL: "swarm@localhost",
} as const;

interface BaselineOptions {
  readonly workspaceRoot: string;
  /** Named in the commit message, so a reader of `git cat-file` knows what wrote it. */
  readonly label: string;
  /** What the turn just measured against, and the parent of the object written here. */
  readonly previousBase: string;
}

async function git(
  root: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  const { stdout } = await runProcess("git", [...args], {
    cwd: root,
    env: environment,
    maxBuffer: 64_000_000,
  });
  return stdout.trim();
}

/**
 * The commit the next turn measures against. Returns null where there is nothing to baseline
 * against yet: a repository with no commits has no parent to hang one from, and the caller
 * keeps the base it already had rather than being handed an object that means something else.
 */
export async function recordTurnBaseline(options: BaselineOptions): Promise<string | null> {
  const { workspaceRoot, label, previousBase } = options;

  const indexDirectory = await mkdtemp(join(tmpdir(), "swarm-turn-index-"));
  // The harness builds this rather than inheriting it: an inherited GIT_INDEX_FILE or
  // GIT_DIR would send `add -A` at a tree nobody asked about.
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    GIT_INDEX_FILE: join(indexDirectory, "index"),
    ...baselineIdentity,
  };

  try {
    const parent = await resolveParent(workspaceRoot, previousBase, environment);
    if (parent === null) {
      return null;
    }

    // read-tree first, so the temporary index starts from the parent rather than from empty:
    // without it `add -A` has nothing to compare against and every path reads as added.
    await git(workspaceRoot, ["read-tree", parent], environment);
    await git(workspaceRoot, ["add", "-A"], environment);
    const tree = await git(workspaceRoot, ["write-tree"], environment);
    return await git(
      workspaceRoot,
      ["commit-tree", tree, "-p", parent, "-m", `swarm baseline after ${label}`],
      environment,
    );
  } catch (cause) {
    throw new TurnBaselineError(workspaceRoot, cause);
  } finally {
    await rm(indexDirectory, { recursive: true, force: true });
  }
}

/** The commit the new object hangs from, or null where the repository has no commit at all. */
async function resolveParent(
  workspaceRoot: string,
  previousBase: string,
  environment: NodeJS.ProcessEnv,
): Promise<string | null> {
  try {
    return await git(
      workspaceRoot,
      ["rev-parse", "--verify", `${previousBase}^{commit}`],
      environment,
    );
  } catch {
    return null;
  }
}
