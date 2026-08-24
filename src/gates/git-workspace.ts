import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { diffAgainstBase } from "./scratch-index.ts";
import { parseUnifiedDiff } from "./unified-diff.ts";
import type {
  CapturedWorkspace,
  WorkspaceChanges,
  WorkspaceCheckpoint,
  WorkspaceProbe,
} from "./workspace-changes.ts";

const runProcess = promisify(execFile);

/**
 * What git said, without what git prints when it thinks you have mistyped a command.
 *
 * `git diff` outside a repository answers with one line of diagnosis followed by its entire
 * option list, and execFile carries all of it on the error message. Reprinting that buries
 * the sentence that says what to do under a hundred lines about `--dirstat` and `--pickaxe`.
 * The reader mistyped nothing: they ran swarm in a directory that is not a repository.
 */
export function firstGitDiagnostic(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const diagnosis = lines.find(
    (line) => line.startsWith("fatal:") || line.startsWith("error:") || line.startsWith("warning:"),
  );
  if (diagnosis !== undefined) return diagnosis;

  // No diagnosis line at all, so keep the first line and drop whatever usage followed it.
  const [first] = lines;
  return first ?? "git produced no output";
}

class GitUnavailableError extends Error {
  constructor(workspaceRoot: string, cause: unknown) {
    super(
      `${workspaceRoot} is not a git working tree, or git could not read it: ` +
        `${firstGitDiagnostic(cause)}. ` +
        "The gates measure a change against a base commit, so run swarm inside a repository " +
        "(git init, then commit something), or pass a base ref that exists.",
    );
    this.name = "GitUnavailableError";
  }
}

export interface GitWorkspaceOptions {
  readonly workspaceRoot: string;
  /** What the change is measured against. HEAD is the ordinary case. */
  readonly baseRef: string;
}

async function git(root: string, args: readonly string[]): Promise<string> {
  const { stdout } = await runProcess("git", [...args], { cwd: root, maxBuffer: 64_000_000 });
  return stdout;
}

/**
 * The working tree as the gates see it: everything that differs from the base commit,
 * including files git does not track yet, because a new file nobody added is still a change
 * the file-set check has to rule on.
 */
export function createGitWorkspaceProbe(options: GitWorkspaceOptions): WorkspaceProbe {
  const { workspaceRoot, baseRef } = options;

  return {
    async changes(): Promise<WorkspaceChanges> {
      // Measured through an index of our own rather than the person's, which is what makes a
      // file git does not track yet read as added instead of as absent. From the real index a
      // path present in the base and untracked here reads as *deleted*, so a session's second
      // turn reported its own edits as deletions with nothing added.
      try {
        return {
          baseRef,
          files: parseUnifiedDiff(await diffAgainstBase({ workspaceRoot, baseRef })),
        };
      } catch (cause) {
        throw new GitUnavailableError(workspaceRoot, cause);
      }
    },

    readCurrent: (path) => readIfPresent(join(workspaceRoot, path)),

    async readBase(path: string): Promise<string | null> {
      try {
        return await git(workspaceRoot, ["show", `${baseRef}:${path}`]);
      } catch {
        // Absent at the base commit, which is a fact about the file, not an error.
        return null;
      }
    },
  };
}

/**
 * Snapshots only what differs from the base, plus whatever the caller names. Restoring is
 * how a ratchet rejection is enforced: the state that traded a number the wrong way stops
 * existing rather than becoming the next attempt's starting point.
 */
export function createGitCheckpoint(options: GitWorkspaceOptions): WorkspaceCheckpoint {
  const probe = createGitWorkspaceProbe(options);

  return {
    async capture(label: string): Promise<CapturedWorkspace> {
      const changes = await probe.changes();
      const files = new Map<string, string | null>();
      for (const file of changes.files) {
        files.set(file.path, await readIfPresent(join(options.workspaceRoot, file.path)));
      }
      return { label, files };
    },

    async restore(captured: CapturedWorkspace): Promise<void> {
      // A capture says "the tree equals the base commit except for these files". So a file
      // the attempt touched that was not in the capture goes back to its base content, and
      // only a file with no base content is removed. Deleting both would take the workspace
      // somewhere neither the capture nor the base commit ever was.
      const now = await probe.changes();
      for (const file of now.files) {
        if (captured.files.has(file.path)) {
          continue;
        }
        const absolute = join(options.workspaceRoot, file.path);
        const base = await probe.readBase(file.path);
        if (base === null) {
          await rm(absolute, { force: true });
          continue;
        }
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, base, "utf8");
      }
      for (const [path, contents] of captured.files) {
        const absolute = join(options.workspaceRoot, path);
        if (contents === null) {
          await rm(absolute, { force: true });
          continue;
        }
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, contents, "utf8");
      }
    },
  };
}

/**
 * Reverts every non-test change to the base commit, leaving the submitted tests in place.
 * That is the base-source control the escape hatch needs, and doing it in the working tree
 * rather than a fresh checkout keeps the installed dependencies, which is what makes a
 * failure on base mean something about the code instead of about the environment.
 */
interface BaseSourceSwap {
  restore(): Promise<void>;
}

export async function revertSourceToBase(
  options: GitWorkspaceOptions,
  keep: (path: string) => boolean,
): Promise<BaseSourceSwap> {
  const probe = createGitWorkspaceProbe(options);
  const changes = await probe.changes();
  const saved = new Map<string, string | null>();

  for (const file of changes.files) {
    if (keep(file.path)) {
      continue;
    }
    const absolute = join(options.workspaceRoot, file.path);
    saved.set(file.path, await readIfPresent(absolute));
    const base = await probe.readBase(file.path);
    if (base === null) {
      await rm(absolute, { force: true });
      continue;
    }
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, base, "utf8");
  }

  return {
    async restore(): Promise<void> {
      for (const [path, contents] of saved) {
        const absolute = join(options.workspaceRoot, path);
        if (contents === null) {
          await rm(absolute, { force: true });
          continue;
        }
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, contents, "utf8");
      }
    },
  };
}

async function readIfPresent(absolute: string): Promise<string | null> {
  try {
    return await readFile(absolute, "utf8");
  } catch {
    return null;
  }
}
