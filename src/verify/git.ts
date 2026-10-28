import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
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
