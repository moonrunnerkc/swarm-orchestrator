import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { parseUnifiedDiff } from "./unified-diff.ts";
import type {
  CapturedWorkspace,
  ChangedFile,
  WorkspaceChanges,
  WorkspaceCheckpoint,
  WorkspaceProbe,
} from "./workspace-changes.ts";

const runProcess = promisify(execFile);

class GitUnavailableError extends Error {
  constructor(workspaceRoot: string, cause: unknown) {
    super(
      `${workspaceRoot} is not a git working tree, or git could not read it: ` +
        `${cause instanceof Error ? cause.message : String(cause)}. ` +
        "The gates measure a change against a base commit, so run swarm inside a repository, " +
        "or pass a base ref that exists.",
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
      let tracked: readonly ChangedFile[];
      try {
        tracked = parseUnifiedDiff(
          await git(workspaceRoot, [
            "diff",
            "--no-color",
            "--no-ext-diff",
            "--unified=0",
            baseRef,
            "--",
          ]),
        );
      } catch (cause) {
        throw new GitUnavailableError(workspaceRoot, cause);
      }

      const untracked = await untrackedChanges(workspaceRoot);
      const seen = new Set(tracked.map((file) => file.path));
      return {
        baseRef,
        files: [...tracked, ...untracked.filter((file) => !seen.has(file.path))],
      };
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

async function untrackedChanges(root: string): Promise<readonly ChangedFile[]> {
  let listing: string;
  try {
    listing = await git(root, ["ls-files", "--others", "--exclude-standard"]);
  } catch {
    return [];
  }

  const files: ChangedFile[] = [];
  for (const path of listing.split("\n").filter((entry) => entry.trim().length > 0)) {
    const text = await readIfPresent(join(root, path));
    if (text === null) {
      continue;
    }
    const lines = text.split("\n");
    files.push({
      path,
      kind: "added",
      addedLines: lines.map((line, index) => ({ line: index + 1, text: line })),
      removedLines: [],
    });
  }
  return files;
}

async function readIfPresent(absolute: string): Promise<string | null> {
  try {
    return await readFile(absolute, "utf8");
  } catch {
    return null;
  }
}
