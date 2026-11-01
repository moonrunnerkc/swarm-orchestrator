import { execFile } from "node:child_process";

/** Variables that would point git at some other repository or index than the one named. */
const repositoryOverrides = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY"];

export class GitError extends Error {
  constructor(args: readonly string[], stderr: string) {
    super(`git ${args.join(" ")} failed: ${stderr.trim() || "no output"}`);
    this.name = "GitError";
  }
}

/** Runs git with hooks disabled and no repository overrides, and returns its trimmed output. */
export function gitText(cwd: string, args: readonly string[]): Promise<string> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const name of repositoryOverrides) delete env[name];
  return new Promise((settle, fail) => {
    execFile(
      "git",
      ["-c", "core.hooksPath=/dev/null", "-c", "core.quotepath=false", ...args],
      { cwd, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error === null) settle(stdout.trim());
        else fail(new GitError(args, stderr));
      },
    );
  });
}
