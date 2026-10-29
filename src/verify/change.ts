import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Variables that would point git at some other repository or index than the one named. */
const repositoryOverrides = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY"];

export class GitError extends Error {
  constructor(args: readonly string[], stderr: string) {
    super(`git ${args.join(" ")} failed: ${stderr.trim() || "no output"}`);
    this.name = "GitError";
  }
}

export interface GitResult {
  readonly stdout: Buffer;
  readonly stderr: string;
  readonly code: number;
}

/** Runs git with hooks disabled and no repository overrides from the caller's environment. */
export function runGit(
  cwd: string,
  args: readonly string[],
  extraEnv: Readonly<Record<string, string>> = {},
): Promise<GitResult> {
  const env: Record<string, string | undefined> = { ...process.env, ...extraEnv };
  for (const name of repositoryOverrides) if (!(name in extraEnv)) delete env[name];
  return new Promise((settle) => {
    execFile(
      "git",
      ["-c", "core.hooksPath=/dev/null", "-c", "core.quotepath=false", ...args],
      { cwd, env, encoding: "buffer", maxBuffer: 256 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
        settle({ stdout, stderr: stderr.toString("utf8"), code });
      },
    );
  });
}

export async function git(
  cwd: string,
  args: readonly string[],
  extraEnv: Readonly<Record<string, string>> = {},
): Promise<Buffer> {
  const result = await runGit(cwd, args, extraEnv);
  if (result.code !== 0) throw new GitError(args, result.stderr);
  return result.stdout;
}

export async function gitText(cwd: string, args: readonly string[]): Promise<string> {
  return (await git(cwd, args)).toString("utf8").trim();
}

/** A private scratch directory, removed by the returned function. */
export async function scratchDirectory(prefix: string): Promise<{
  readonly path: string;
  remove(): Promise<void>;
}> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  return { path, remove: () => rm(path, { recursive: true, force: true }) };
}

/** Where the change comes from. Each resolves to a base commit and the exact patch bytes. */
export type ChangeRequest =
  | { readonly kind: "working-tree"; readonly base: string }
  | { readonly kind: "range"; readonly range: string }
  | { readonly kind: "patch"; readonly path: string; readonly base: string };

export interface ResolvedChange {
  readonly source: ChangeRequest["kind"];
  readonly baseCommit: string;
  readonly patch: Buffer;
}

export class UnreadableChangeError extends Error {
  constructor(detail: string) {
    super(`the change cannot be read: ${detail}`);
    this.name = "UnreadableChangeError";
  }
}

const diffFlags = [
  "diff",
  "--binary",
  "--no-color",
  "--no-ext-diff",
  "--no-renames",
  "--no-textconv",
];
/** The verifier's own output directory never belongs to a change. */
const notTheChange = ":(exclude).swarm";

export async function commitOf(workspace: string, ref: string): Promise<string> {
  try {
    return await gitText(workspace, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${ref}^{commit}`,
    ]);
  } catch {
    throw new UnreadableChangeError(`${ref} is not a commit in ${workspace}`);
  }
}

export async function resolveChange(
  workspace: string,
  request: ChangeRequest,
): Promise<ResolvedChange> {
  if (request.kind === "patch") {
    const patch = await readFile(request.path).catch(() => {
      throw new UnreadableChangeError(`${request.path} cannot be read`);
    });
    return { source: "patch", baseCommit: await commitOf(workspace, request.base), patch };
  }
  if (request.kind === "range") {
    const [from, to, extra] = request.range.split("..");
    if (from === undefined || to === undefined || extra !== undefined || !from || !to) {
      throw new UnreadableChangeError(`${request.range} is not a range of the form base..head`);
    }
    const baseCommit = await commitOf(workspace, from);
    const head = await commitOf(workspace, to);
    const patch = await git(workspace, [...diffFlags, baseCommit, head, "--", ".", notTheChange]);
    return { source: "range", baseCommit, patch };
  }
  const baseCommit = await commitOf(workspace, request.base);
  // A private index holding the whole working tree, untracked files included, so the
  // workspace's own index is never touched.
  const scratch = await scratchDirectory("swarm-index-");
  try {
    const env = { GIT_INDEX_FILE: join(scratch.path, "index") };
    await git(workspace, ["read-tree", baseCommit], env);
    await git(workspace, ["add", "-A", "--", ".", notTheChange], env);
    const patch = await git(workspace, [...diffFlags, "--cached", baseCommit], env);
    return { source: "working-tree", baseCommit, patch };
  } finally {
    await scratch.remove();
  }
}
