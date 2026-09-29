import { execFile } from "node:child_process";
import { access, chmod, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { type CheckReport, renderReport } from "../cli-check.ts";

const run = promisify(execFile);

/**
 * The pre-commit integration verifies the staged tree and nothing else. The index is written
 * to a tree object, that tree becomes an unreferenced commit on top of HEAD, and a detached
 * worktree of that commit is checked, with the working tree's installed dependencies borrowed
 * by link and named as borrowed. Unstaged edits, untracked files and the person's branch are
 * never read and never touched: nothing is stashed, reset or rewritten. Evidence is bound to
 * the staged tree's identity, so a later `git add` invalidates it by construction.
 *
 * A git hook is a convenience, not a boundary: `git commit --no-verify` skips it, and a hook
 * file is editable by whoever can commit. CI remains the independent check.
 */
export const hookMarker = "# swarm-verify pre-commit hook";

export interface PreCommitOutcome {
  readonly exitCode: number;
  readonly lines: readonly string[];
}

/**
 * Inside a git hook the environment names the repository and, for a partial commit, a
 * temporary index (`GIT_DIR`, `GIT_INDEX_FILE`). Reading the staged tree must honour that
 * index, since it is what is being committed; creating and removing the worktree must not,
 * since a relative `GIT_DIR` read from another directory is not this repository.
 */
function hookEnvironment(keepIndex: boolean): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (name.startsWith("GIT_") && !(keepIndex && name === "GIT_INDEX_FILE")) continue;
    environment[name] = value;
  }
  return environment;
}

async function git(cwd: string, args: readonly string[], keepIndex = false): Promise<string> {
  const ran = await run("git", args, {
    cwd,
    maxBuffer: 64_000_000,
    env: hookEnvironment(keepIndex),
  });
  return ran.stdout.trim();
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** Verify what is staged in `repository` with the verifier at `entry`. */
export async function verifyStaged(options: {
  readonly repository: string;
  readonly entry: string;
  readonly json: boolean;
  readonly home: string;
}): Promise<PreCommitOutcome> {
  const { repository } = options;
  let top: string;
  try {
    top = await git(repository, ["rev-parse", "--show-toplevel"]);
  } catch {
    return { exitCode: 4, lines: ["not a git repository, so there is no staged tree to verify"] };
  }
  const staged = await git(top, ["diff", "--cached", "--name-only"], true);
  if (staged.length === 0)
    return { exitCode: 0, lines: ["nothing is staged, so nothing was verified"] };
  const tree = await git(top, ["write-tree"], true);
  const head = await git(top, ["rev-parse", "--verify", "HEAD"]).catch(() => null);
  const commit = await git(top, [
    "-c",
    "user.name=swarm-verify",
    "-c",
    "user.email=swarm-verify@localhost",
    "commit-tree",
    tree,
    ...(head === null ? [] : ["-p", head]),
    "-m",
    "staged tree under verification",
  ]);
  const scratch = await mkdirTemp();
  const worktree = join(scratch, "staged");
  try {
    await git(top, ["worktree", "add", "--detach", "--quiet", worktree, commit]);
    // The working tree's installed dependencies, borrowed by link and recorded as such, so the
    // staged tree is checked without an install on every commit.
    const borrowed: string[] = [];
    for (const directory of ["node_modules", ".venv"]) {
      if ((await exists(join(top, directory))) && !(await exists(join(worktree, directory)))) {
        await symlink(join(top, directory), join(worktree, directory), "dir");
        borrowed.push(directory);
      }
    }
    // Measured against the commit the staged tree would follow: that commit's manifests decide
    // the commands and its tree is the instrument's reference, so a staged configuration or
    // script change is a change, not the reference it is compared with.
    const ran = await runVerifier(
      options.entry,
      ["check", "--workspace", worktree, "--json", ...(head === null ? [] : ["--base", head])],
      options.home,
    );
    let report: CheckReport | null = null;
    try {
      report = JSON.parse(
        ran.stdout
          .trim()
          .split("\n")
          .findLast((line) => line.startsWith("{")) ?? "null",
      ) as CheckReport | null;
    } catch {
      report = null;
    }
    const lines = [
      `staged tree ${tree} (commit ${commit.slice(0, 12)} on ${head?.slice(0, 12) ?? "no parent"})`,
      `dependencies ${borrowed.length === 0 ? "none borrowed" : `borrowed from the working tree by link: ${borrowed.join(", ")}`}`,
      ...(report === null
        ? [`the verifier exited ${ran.code} without a report`]
        : options.json
          ? [JSON.stringify({ ...report, stagedTree: tree, stagedCommit: commit, borrowed })]
          : renderReport(report)),
    ];
    return { exitCode: report?.exitCode ?? (ran.code || 5), lines };
  } finally {
    await git(top, ["worktree", "remove", "--force", worktree]).catch(() => undefined);
    await git(top, ["worktree", "prune"]).catch(() => undefined);
    await rm(scratch, { recursive: true, force: true });
  }
}

async function mkdirTemp(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(join(tmpdir(), "swarm-precommit-"));
}

async function runVerifier(entry: string, args: readonly string[], home: string) {
  try {
    const ran = await run(process.execPath, [entry, ...args], {
      env: { PATH: process.env.PATH ?? "", HOME: home, NO_COLOR: "1" },
      maxBuffer: 16_000_000,
      timeout: 1_800_000,
    });
    return { code: 0, stdout: ran.stdout };
  } catch (cause) {
    const failed = cause as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 5, stdout: `${failed.stdout ?? ""}${failed.stderr ?? ""}` };
  }
}

/** Write `.git/hooks/pre-commit` calling the verifier, or leave a foreign hook alone and say so. */
export async function installPreCommit(
  repository: string,
  entry: string,
): Promise<{
  readonly state: "installed" | "present" | "foreign";
  readonly path: string;
  readonly line: string;
}> {
  const top = await git(repository, ["rev-parse", "--show-toplevel"]);
  const hooksDirectory = await git(top, ["rev-parse", "--git-path", "hooks"]);
  const path = join(top, hooksDirectory, "pre-commit");
  const line = `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(entry)} pre-commit`;
  const content = `#!/bin/sh\n${hookMarker}\n${line}\n`;
  if (await exists(path)) {
    const current = await readFile(path, "utf8");
    if (current.includes(hookMarker)) return { state: "present", path, line };
    return { state: "foreign", path, line };
  }
  await mkdir(join(top, hooksDirectory), { recursive: true });
  await writeFile(path, content, { mode: 0o755 });
  await chmod(path, 0o755);
  return { state: "installed", path, line };
}

/** Remove the hook only where it is ours. */
export async function uninstallPreCommit(
  repository: string,
): Promise<{ readonly state: "removed" | "absent" | "foreign"; readonly path: string }> {
  const top = await git(repository, ["rev-parse", "--show-toplevel"]);
  const path = join(top, await git(top, ["rev-parse", "--git-path", "hooks"]), "pre-commit");
  if (!(await exists(path))) return { state: "absent", path };
  const current = await readFile(path, "utf8");
  if (!current.includes(hookMarker)) return { state: "foreign", path };
  await rm(path);
  return { state: "removed", path };
}
