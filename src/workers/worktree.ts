import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { promisify } from "node:util";

const runProcess = promisify(execFile);

interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/**
 * Git is the isolation mechanism here, so it is called directly rather than through the tool
 * chokepoint: none of these arguments comes from a model, and a worker's own commands still
 * go through the chokepoint inside its worktree.
 */
async function git(cwd: string, args: readonly string[]): Promise<ProcessResult> {
  try {
    const { stdout, stderr } = await runProcess("git", [...args], {
      cwd,
      maxBuffer: 64_000_000,
    });
    return { stdout, stderr, code: 0 };
  } catch (cause) {
    const failure = cause as { stdout?: string; stderr?: string; code?: number; message?: string };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message ?? "",
      code: failure.code ?? 1,
    };
  }
}

async function gitOrThrow(cwd: string, args: readonly string[]): Promise<string> {
  const result = await git(cwd, args);
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
  commitAll(message: string): Promise<string | null>;
  /** Takes the working copy away. The branch stays, because the queue still needs it. */
  remove(): Promise<void>;
}

/**
 * One worker, one working copy, one branch. Worktrees share the repository's object store, so
 * this costs a checkout rather than a clone, and two workers cannot see each other's edits.
 */
export async function addWorktree(options: WorktreeOptions): Promise<Worktree> {
  await gitOrThrow(options.repositoryRoot, [
    "worktree",
    "add",
    "--quiet",
    "-b",
    options.branch,
    options.path,
    options.baseRef,
  ]);

  return {
    path: options.path,
    branch: options.branch,

    async commitAll(message: string): Promise<string | null> {
      await gitOrThrow(options.path, ["add", "--all"]);
      const staged = await git(options.path, ["diff", "--cached", "--quiet"]);
      if (staged.code === 0) {
        return null;
      }
      await gitOrThrow(options.path, ["commit", "--quiet", "--no-verify", "-m", message]);
      return headCommit(options.path);
    },

    async remove(): Promise<void> {
      await git(options.repositoryRoot, ["worktree", "remove", "--force", options.path]);
      // Belt and braces: a worktree git declined to remove must still not be left behind,
      // because the next run would find a path it cannot add.
      await rm(options.path, { recursive: true, force: true });
      await git(options.repositoryRoot, ["worktree", "prune"]);
    },
  };
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
): Promise<MergeOutcome> {
  const merge = await git(worktreePath, ["merge", "--no-ff", "--no-verify", "-m", message, branch]);
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

export async function headCommit(worktreePath: string): Promise<string> {
  return (await gitOrThrow(worktreePath, ["rev-parse", "HEAD"])).trim();
}

/** Puts an integration worktree back on an accepted commit after a rejection. */
export async function resetHard(worktreePath: string, ref: string): Promise<void> {
  await gitOrThrow(worktreePath, ["reset", "--hard", "--quiet", ref]);
  await gitOrThrow(worktreePath, ["clean", "-fd", "--quiet"]);
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
): Promise<readonly string[]> {
  await git(repositoryRoot, ["worktree", "prune"]);

  const listed = await git(repositoryRoot, ["branch", "--format=%(refname:short)"]);
  const mine = listed.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((name) => name.startsWith(`swarm/${runId}/`) && !name.endsWith("/integration"));

  const removed: string[] = [];
  for (const branch of mine) {
    const outcome = await git(repositoryRoot, ["branch", "-D", branch]);
    if (outcome.code === 0) {
      removed.push(branch);
    }
  }
  return removed;
}
