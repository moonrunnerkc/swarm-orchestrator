import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { harnessChildEnvironment } from "../exec/child-environment.ts";

const runProcess = promisify(execFile);

interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/**
 * Git separates candidate changes, not runtime access. Controller-owned operations call it
 * directly; worker commands still pass through the tool chokepoint.
 */
async function git(
  cwd: string,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<ProcessResult> {
  try {
    const { stdout, stderr } = await runProcess(
      "git",
      ["-c", "user.name=Swarm Orchestrator", "-c", "user.email=swarm@localhost", ...args],
      {
        cwd,
        maxBuffer: 64_000_000,
        timeout: 30_000,
        ...(signal === undefined ? {} : { signal }),
        env: harnessChildEnvironment().variables,
      },
    );
    return { stdout, stderr, code: 0 };
  } catch (cause) {
    const failure = cause as { stdout?: string; stderr?: string; code?: number; message?: string };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message ?? "",
      code: typeof failure.code === "number" ? failure.code : 1,
    };
  }
}

async function gitOrThrow(
  cwd: string,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const result = await git(cwd, args, signal);
  if (result.code !== 0) {
    throw new WorktreeError(`git ${args.join(" ")}`, `${result.stdout}${result.stderr}`.trim());
  }
  return result.stdout;
}

class WorktreeError extends Error {
  constructor(command: string, detail: string) {
    super(
      `${command} failed: ${detail}. A parallel run needs a git repository it can add ` +
        "worktrees to, with a clean base commit to branch from.",
    );
    this.name = "WorktreeError";
  }
}

/**
 * The tail of each repository's queue of worktree administration, keyed by its resolved root.
 *
 * Git records every linked worktree under the repository's `.git/worktrees`, and its worktree
 * commands read all of those records: `worktree add` resolves each registered worktree's HEAD
 * before it registers its own, and `worktree remove`, `worktree list`, `worktree prune` and
 * `branch -D` walk the same directory. Git does not serialize that directory between
 * processes. Workers are dispatched together, so two `worktree add` calls ran at once, and one
 * read the other's `commondir` between its creation and its write: "failed to read
 * .git/worktrees/worker-2/commondir", after which that worker never reached the merge queue
 * (issue #75). Every such command this process issues against one repository therefore runs
 * alone. A second process administering the same repository is outside this queue.
 */
const administrationQueues = new Map<string, Promise<void>>();

async function administer<T>(repositoryRoot: string, operation: () => Promise<T>): Promise<T> {
  // Resolved, so two spellings of one repository share one queue. A root that cannot be
  // resolved is queued as spelled and left for git to report.
  const key = await realpath(repositoryRoot).catch(() => resolve(repositoryRoot));
  const previous = administrationQueues.get(key) ?? Promise.resolve();
  const turn = previous.then(operation);
  const settled = turn.then(
    () => undefined,
    () => undefined,
  );
  administrationQueues.set(key, settled);
  try {
    return await turn;
  } finally {
    if (administrationQueues.get(key) === settled) administrationQueues.delete(key);
  }
}

interface WorktreeOptions {
  readonly repositoryRoot: string;
  /** Where the working copy goes. Outside the repository, so it is never a change to it. */
  readonly path: string;
  readonly branch: string;
  readonly baseRef: string;
}

export interface Worktree {
  readonly path: string;
  readonly branch: string;
  /** Stages everything and commits. Null when the worker changed nothing worth landing. */
  commitAll(message: string, signal?: AbortSignal): Promise<string | null>;
  /** Takes the working copy away. The branch stays, because the queue still needs it. */
  remove(signal?: AbortSignal): Promise<void>;
}

/**
 * One worker, one working copy, one branch. Worktrees share the repository's object store, so
 * this costs a checkout rather than a clone, and two workers cannot see each other's edits.
 */
export async function addWorktree(options: WorktreeOptions): Promise<Worktree> {
  await administer(options.repositoryRoot, () =>
    gitOrThrow(options.repositoryRoot, [
      "worktree",
      "add",
      "--quiet",
      "-b",
      options.branch,
      options.path,
      options.baseRef,
    ]),
  );

  return worktreeHandle(options);
}

export async function reopenWorktree(options: WorktreeOptions): Promise<Worktree> {
  const handle = worktreeHandle(options);
  await verifyWorktreeOwnership(options);
  return handle;
}

export async function restoreWorktree(options: WorktreeOptions): Promise<Worktree> {
  const actual = (await gitOrThrow(options.repositoryRoot, ["rev-parse", options.branch])).trim();
  if (actual !== options.baseRef)
    throw new WorktreeError(
      "restore worktree",
      "branch changed since its recorded accepted commit; preserve and reconcile",
    );
  await administer(options.repositoryRoot, () =>
    gitOrThrow(options.repositoryRoot, [
      "worktree",
      "add",
      "--quiet",
      options.path,
      options.branch,
    ]),
  );
  return worktreeHandle(options);
}

function worktreeHandle(options: WorktreeOptions): Worktree {
  return {
    path: options.path,
    branch: options.branch,

    async commitAll(message: string, signal?: AbortSignal): Promise<string | null> {
      await gitOrThrow(options.path, ["add", "--all"], signal);
      const staged = await git(options.path, ["diff", "--cached", "--quiet"], signal);
      if (staged.code === 0) {
        return null;
      }
      await gitOrThrow(options.path, ["commit", "--quiet", "--no-verify", "-m", message], signal);
      return headCommit(options.path, signal);
    },

    async remove(signal?: AbortSignal): Promise<void> {
      // One turn from the ownership check through the removal, so no other registration
      // changes between what was checked and what is removed.
      await administer(options.repositoryRoot, async () => {
        await checkWorktreeOwnership(options, signal);
        const changed = await gitOrThrow(
          options.path,
          ["status", "--porcelain", "--untracked-files=all"],
          signal,
        );
        if (changed.trim() !== "")
          throw new WorktreeError(
            "remove worktree",
            `uncommitted files remain at ${options.path}; preserve them and reconcile before cleanup`,
          );
        await gitOrThrow(
          options.repositoryRoot,
          ["worktree", "remove", "--force", options.path],
          signal,
        );
      });
    },
  };
}

export async function verifyWorktreeOwnership(
  options: WorktreeOptions,
  signal?: AbortSignal,
): Promise<void> {
  await administer(options.repositoryRoot, () => checkWorktreeOwnership(options, signal));
}

/** Reads every registration, so it runs only inside an administration turn. */
async function checkWorktreeOwnership(
  options: WorktreeOptions,
  signal?: AbortSignal,
): Promise<void> {
  const listing = await gitOrThrow(
    options.repositoryRoot,
    ["worktree", "list", "--porcelain", "-z"],
    signal,
  );
  const ownedPath = await realpath(options.path);
  const entries = listing.split("\0\0").map((entry) => entry.split("\0"));
  if (
    !entries.some(
      (entry) =>
        entry.includes(`worktree ${ownedPath}`) &&
        entry.includes(`branch refs/heads/${options.branch}`),
    )
  )
    throw new WorktreeError(
      "inspect worktree",
      `ownership of ${options.path} changed; preserve it and reconcile`,
    );
}

interface MergeOutcome {
  readonly merged: boolean;
  /** The merge commit, or null when nothing was merged. */
  readonly commit: string | null;
  /** Git's own words. What a rejected worker is handed, unsummarized. */
  readonly output: string;
  readonly conflictingPaths: readonly string[];
}

/**
 * Merges one worker's branch into an integration worktree. A conflict aborts back to exactly
 * where the tree was, because the queue's next candidate has to start from an accepted state
 * rather than from a half-merged one.
 */
export async function mergeBranch(
  worktreePath: string,
  branch: string,
  message: string,
  signal?: AbortSignal,
): Promise<MergeOutcome> {
  const merge = await git(
    worktreePath,
    ["merge", "--no-ff", "--no-verify", "-m", message, branch],
    signal,
  );
  if (merge.code === 0) {
    return {
      merged: true,
      commit: await headCommit(worktreePath),
      output: merge.stdout.trim(),
      conflictingPaths: [],
    };
  }

  const conflicting = await git(worktreePath, ["diff", "--name-only", "--diff-filter=U"]);
  await git(worktreePath, ["merge", "--abort"]);
  await git(worktreePath, ["reset", "--hard", "--quiet"]);

  return {
    merged: false,
    commit: null,
    output: `${merge.stdout}${merge.stderr}`.trim(),
    conflictingPaths: conflicting.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  };
}

export async function headCommit(worktreePath: string, signal?: AbortSignal): Promise<string> {
  return (await gitOrThrow(worktreePath, ["rev-parse", "HEAD"], signal)).trim();
}

/** Puts an integration worktree back on an accepted commit after a rejection. */
export async function resetHard(
  worktreePath: string,
  ref: string,
  signal?: AbortSignal,
): Promise<void> {
  await gitOrThrow(worktreePath, ["reset", "--hard", "--quiet", ref], signal);
  await gitOrThrow(worktreePath, ["clean", "-fd", "--quiet"], signal);
}

/**
 * Removes the branches a run created, once the queue has finished with them.
 *
 * A worker's branch outlives its worktree on purpose: the queue merges from it after the
 * working copy is gone. Nothing removed them afterwards, so a repository gained
 * `tasks x redundancy + 1` branches per run and kept them. The integration branch is not
 * swept, because that is the run's result and the report tells the person to merge it.
 *
 * A branch git still considers checked out is left alone rather than forced. That means a
 * worktree this process did not manage to remove, and deleting the branch under it would
 * leave the repository in a state neither of them agrees about. Pruning first is what makes
 * that rare: a run killed part-way leaves registrations pointing at directories that are
 * already gone, and the next run fails adding a worktree at a path git still believes in.
 */
export async function sweepRunBranches(
  repositoryRoot: string,
  runId: string,
  owned?: readonly { branch: string; commit: string | null }[],
): Promise<readonly string[]> {
  // Pruning and `branch -D` both read every registration, so the whole sweep is one turn.
  return administer(repositoryRoot, async () => {
    await git(repositoryRoot, ["worktree", "prune"]);

    const listed = await git(repositoryRoot, ["branch", "--format=%(refname:short)"]);
    const mine = listed.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((name) => name.startsWith(`swarm/${runId}/`) && !name.endsWith("/integration"));

    const removed: string[] = [];
    for (const branch of mine) {
      if (owned !== undefined) {
        const expected = owned.find((candidate) => candidate.branch === branch)?.commit;
        if (expected === undefined || expected === null) continue;
        const observed = await git(repositoryRoot, ["rev-parse", branch]);
        if (observed.stdout.trim() !== expected) continue;
      }
      const outcome = await git(repositoryRoot, ["branch", "-D", branch]);
      if (outcome.code === 0) {
        removed.push(branch);
      }
    }
    return removed;
  });
}
