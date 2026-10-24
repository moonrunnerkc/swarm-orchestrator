import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Installed environments a diagnostic over the base reads from the workspace, as the base has none. */
const sharedEnvironments = ["node_modules", ".venv"];

/**
 * The base commit's files in a directory of their own for the length of `use`, beside the
 * workspace's installed dependencies, then removed. The files come from `git archive`, so nothing
 * the worker wrote reaches them; the dependencies are linked, not copied, and are the same ones
 * the workspace's own diagnostic runs against, so a difference between the two runs is a
 * difference in the project's own files. Made fresh for each use: nothing is kept between calls.
 */
export async function withBaseSnapshot<T>(
  workspace: string,
  baseCommit: string,
  use: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "swarm-base-"));
  try {
    const archive = join(directory, ".swarm-base.tar");
    await run("git", [
      "-C",
      workspace,
      "archive",
      "--format=tar",
      `--output=${archive}`,
      baseCommit,
    ]);
    await run("tar", ["-xf", archive, "-C", directory]);
    await rm(archive, { force: true });
    for (const name of sharedEnvironments)
      if (existsSync(join(workspace, name)) && !existsSync(join(directory, name)))
        await symlink(join(workspace, name), join(directory, name));
    return await use(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * The workspace's files as they stand, tracked and untracked but not ignored, copied into a
 * directory of their own for the length of `use`, beside the same installed dependencies, then
 * removed. What runs there (a reviewer's trial of a probe) can write what it likes without
 * touching the candidate it is reading. The dependencies are linked, so a program that writes
 * through them reaches the workspace's own: that residual is named where this is used.
 */
export async function withWorkspaceSnapshot<T>(
  workspace: string,
  use: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "swarm-candidate-"));
  try {
    const listed = await run(
      "git",
      ["-C", workspace, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { maxBuffer: 1 << 26 },
    );
    for (const path of new Set(listed.stdout.split("\0").filter((one) => one.length > 0))) {
      if (!existsSync(join(workspace, path))) continue;
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await copyFile(join(workspace, path), join(directory, path));
    }
    for (const name of sharedEnvironments)
      if (existsSync(join(workspace, name)) && !existsSync(join(directory, name)))
        await symlink(join(workspace, name), join(directory, name));
    return await use(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
