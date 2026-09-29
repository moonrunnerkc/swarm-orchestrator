import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
  /**
   * Untracked Python virtual environments to leave out of the change, as `untrackedEnvironments`
   * named them. Only the standalone check of a person's own working tree passes any: a session
   * or a patch writes its files untracked too, and nothing it writes may hide itself.
   */
  readonly excludedEnvironments?: readonly string[];
}

/** An exclusion the base commit contradicts: the directory holds tracked files. */
export class ExcludedEnvironmentTrackedError extends Error {
  readonly directory: string;

  constructor(directory: string) {
    super(
      `${directory} was named as an untracked Python environment, but it is tracked at the base commit; ` +
        "only untracked directories holding pyvenv.cfg can be left out of the change",
    );
    this.name = "ExcludedEnvironmentTrackedError";
    this.directory = directory;
  }
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
 * What running the code writes and nobody edits: the interpreter caches Python leaves beside
 * the files it ran. Charging them as changes had the file-set gate fail an attempt for
 * `__pycache__/scraper.cpython-314.pyc` after the tests it ran itself wrote it, and the ratchet
 * then rejected the attempt for a gate that had passed before, discarding the work. Named by
 * directory, never by content, and nothing under them is ever source.
 */
const interpreterCacheExclusions: readonly string[] = [
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
].flatMap((cache) => [`:(glob)${cache}/**`, `:(glob)**/${cache}/**`]);

/**
 * The untracked Python virtual environments in a person's working tree, as workspace-relative
 * directories. A directory holding `pyvenv.cfg` with a `home` key at its root is a virtual
 * environment by definition (PEP 405); uv and Python 3.13 mark one ignored by writing a
 * `.gitignore` inside it, and an older `python -m venv` does not, so its interpreter and every
 * installed package read as the change being checked.
 *
 * Only what nobody tracks qualifies: the `pyvenv.cfg` must be untracked and unstaged, and the
 * directory that directly holds it must have nothing in the person's index, at `HEAD` or at
 * the base. A git failure answers "tracked", so the directory stays in the change. The
 * workspace root never qualifies.
 */
export async function untrackedEnvironments(
  options: Pick<ScratchIndexOptions, "workspaceRoot" | "baseRef">,
): Promise<readonly string[]> {
  const environment = gitEnvironment({});
  const listed = async (args: readonly string[]): Promise<readonly string[]> =>
    (await runGit(options.workspaceRoot, args, environment))
      .split("\0")
      .filter((path) => path.length > 0);
  const marker = "/pyvenv.cfg";
  const candidates = (await listed(["ls-files", "-z", "--others", "--exclude-standard"]))
    .filter((path) => path.endsWith(marker))
    .map((path) => path.slice(0, -marker.length))
    .sort();
  const references = [...new Set(["HEAD", options.baseRef])];
  const found: string[] = [];
  for (const directory of candidates) {
    if (found.some((outer) => directory.startsWith(`${outer}/`))) continue;
    const configuration = await readFile(
      join(options.workspaceRoot, directory, "pyvenv.cfg"),
      "utf8",
    ).catch(() => "");
    if (!/^[ \t]*home[ \t]*=/m.test(configuration)) continue;
    if (await trackedAnywhere(directory, references, listed)) continue;
    found.push(directory);
  }
  return found;
}

async function trackedAnywhere(
  directory: string,
  references: readonly string[],
  listed: (args: readonly string[]) => Promise<readonly string[]>,
): Promise<boolean> {
  try {
    if ((await listed(["ls-files", "-z", "--cached", "--", `:(literal)${directory}`])).length > 0)
      return true;
    for (const reference of references)
      if (
        (await listed(["ls-tree", "-r", "-z", "--name-only", reference, "--", directory])).length >
        0
      )
        return true;
    return false;
  } catch {
    return true;
  }
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
    // Stage everything, then drop the caches from the index. Naming a cache as an exclude
    // pathspec on `add` is refused by git (exit 1, "paths are ignored") the moment that cache
    // exists and is gitignored, which is the ordinary state of a Python checkout after one
    // test run; removing from the index afterwards is quiet whether the cache was staged,
    // ignored or absent.
    await git(["add", "-A", "--", "."]);
    await git([
      "rm",
      "-r",
      "--cached",
      "--quiet",
      "--ignore-unmatch",
      "--",
      ...interpreterCacheExclusions,
    ]);
    const excluded = options.excludedEnvironments ?? [];
    if (excluded.length > 0) {
      // Checked again here rather than trusted: removing a tracked directory from this index
      // would read its files as deleted, and would hide whatever changed inside it.
      for (const directory of excluded)
        if (
          (await git(["ls-tree", "-r", "-z", "--name-only", options.baseRef, "--", directory])) !==
          ""
        )
          throw new ExcludedEnvironmentTrackedError(directory);
      await git([
        "rm",
        "-r",
        "--cached",
        "--quiet",
        "--ignore-unmatch",
        "--",
        ...excluded.map((directory) => `:(literal)${directory}`),
      ]);
    }
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

/**
 * The same change as a patch another checkout can apply: full context and binary content.
 * `diffAgainstBase` is zero-context, which is what line measurement wants and what `git apply`
 * refuses for any hunk that modifies an existing file.
 */
export async function patchAgainstBase(options: ScratchIndexOptions): Promise<string> {
  return withScratchIndex(options, (git) =>
    git([
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--binary",
      "--full-index",
      "--cached",
      options.baseRef,
      "--",
    ]),
  );
}
