import { createHash } from "node:crypto";
import { lstat, readFile, readlink, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { git, runGit, scratchDirectory } from "./change.ts";

export interface ChangedFile {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted";
  /** Line numbers on the new side that the change added or rewrote. */
  readonly addedLines: readonly number[];
}

export interface BaseCheckout {
  /** A clean clone of the base commit, owned by this run. */
  readonly dir: string;
  readonly baseCommit: string;
  remove(): Promise<void>;
}

export interface AppliedChange {
  readonly changed: readonly ChangedFile[];
  /** SHA-256 over the resulting tree's files, recomputable without git (see treeDigest). */
  readonly treeSha256: string;
  readonly gitTree: string;
}

export type ApplyOutcome =
  | { readonly applied: true; readonly result: AppliedChange }
  | { readonly applied: false; readonly reason: string };

const statusOf = { A: "added", M: "modified", D: "deleted", T: "modified" } as const;

/** A clean clone of the base commit sharing the workspace's objects. */
export async function cloneBase(workspace: string, baseCommit: string): Promise<BaseCheckout> {
  const scratch = await scratchDirectory("swarm-verify-");
  const dir = join(await realpath(scratch.path), "tree");
  try {
    await git(scratch.path, ["clone", "--quiet", "--no-checkout", "--shared", workspace, dir]);
    await git(dir, ["checkout", "--quiet", "--detach", baseCommit]);
  } catch (error) {
    await scratch.remove();
    throw error;
  }
  return { dir, baseCommit, remove: scratch.remove };
}

/** Applies the patch to the base checkout and reads what changed from git itself. */
export async function applyChange(checkout: BaseCheckout, patch: Buffer): Promise<ApplyOutcome> {
  const patchFile = join(checkout.dir, "..", "change.patch");
  await writeFile(patchFile, patch);
  if (patch.length > 0) {
    const applied = await runGit(checkout.dir, [
      "apply",
      "--index",
      "--whitespace=nowarn",
      patchFile,
    ]);
    if (applied.code !== 0) {
      return { applied: false, reason: `the change does not apply: ${applied.stderr.trim()}` };
    }
  }
  return {
    applied: true,
    result: {
      changed: await changedFiles(checkout.dir, checkout.baseCommit),
      treeSha256: await treeDigest(checkout.dir),
      gitTree: (await git(checkout.dir, ["write-tree"])).toString("utf8").trim(),
    },
  };
}

/** Puts each path back as the base had it, removing the ones the base did not have. */
export async function restoreFromBase(
  checkout: BaseCheckout,
  paths: readonly string[],
): Promise<void> {
  for (const path of paths) {
    const object = `${checkout.baseCommit}:${path}`;
    if ((await runGit(checkout.dir, ["cat-file", "-e", object])).code === 0) {
      await git(checkout.dir, ["checkout", checkout.baseCommit, "--", path]);
    } else {
      await rm(join(checkout.dir, path), { force: true });
    }
  }
}

async function changedFiles(dir: string, baseCommit: string): Promise<readonly ChangedFile[]> {
  const listing = (
    await git(dir, ["diff", "--cached", "--name-status", "-z", "--no-renames", baseCommit])
  )
    .toString("utf8")
    .split("\0");
  const files: ChangedFile[] = [];
  for (let at = 0; at + 1 < listing.length; at += 2) {
    const code = (listing[at] ?? "").slice(0, 1) as keyof typeof statusOf;
    const path = listing[at + 1] ?? "";
    const status = statusOf[code] ?? "modified";
    const addedLines = status === "deleted" ? [] : await addedLinesOf(dir, baseCommit, path);
    files.push({ path, status, addedLines });
  }
  return files;
}

/** New-side line numbers from the zero-context hunk headers git writes for one file. */
async function addedLinesOf(dir: string, baseCommit: string, path: string): Promise<number[]> {
  const diff = await git(dir, ["diff", "--cached", "-U0", "--no-color", baseCommit, "--", path]);
  const lines: number[] = [];
  for (const match of diff.toString("utf8").matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    for (let line = start; line < start + count; line += 1) lines.push(line);
  }
  return lines;
}

/**
 * SHA-256 over `<mode> <sha256 of content> <path>\n` for every tracked file, sorted by path
 * bytes. Symlinks hash their target and submodules are left out, so packages/swarm-verify/verify.mjs
 * can recompute the same digest from a plain export of the tree.
 */
export async function treeDigest(dir: string): Promise<string> {
  const entries = (await git(dir, ["ls-files", "-s", "-z"])).toString("utf8").split("\0");
  const lines: { readonly path: Buffer; readonly line: string }[] = [];
  for (const entry of entries) {
    const match = /^(\d{6}) [0-9a-f]+ \d\t(.+)$/s.exec(entry);
    const mode = match?.[1];
    const path = match?.[2];
    if (mode === undefined || path === undefined || mode === "160000") continue;
    const absolute = join(dir, path);
    const content = (await lstat(absolute)).isSymbolicLink()
      ? Buffer.from(await readlink(absolute))
      : await readFile(absolute);
    const digest = createHash("sha256").update(content).digest("hex");
    lines.push({ path: Buffer.from(path), line: `${mode} ${digest} ${path}\n` });
  }
  lines.sort((a, b) => Buffer.compare(a.path, b.path));
  return createHash("sha256")
    .update(lines.map((entry) => entry.line).join(""))
    .digest("hex");
}
