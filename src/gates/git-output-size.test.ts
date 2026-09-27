import { describe, expect, it } from "vitest";
import { describeGitFailure } from "./git-workspace.ts";

/**
 * A repository whose `git status` output is larger than the read buffer produced
 * "is not a git working tree", which is false and sends the reader to `git init` in a
 * directory that is already a repository. It happened on a checkout carrying a large
 * untracked corpus: git ran fine and the harness could not hold what it said.
 */
describe("git output the harness could not hold", () => {
  it("is reported as an output-size failure, not as a missing repository", () => {
    const failure = describeGitFailure("/repo", {
      message: "stdout maxBuffer length exceeded",
      code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
    });

    expect(failure).toMatch(/more output than the harness can hold/i);
    expect(failure).not.toMatch(/is not a git working tree/i);
  });

  it("names something the reader can do about it", () => {
    const failure = describeGitFailure("/repo", {
      message: "stdout maxBuffer length exceeded",
      code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
    });

    expect(failure).toMatch(/ignore|untracked|\.gitignore/i);
  });

  it("quotes what git said when a command fails inside a repository, and does not send the reader to git init", () => {
    const failure = describeGitFailure("/repo", {
      message:
        "Command failed: git add -A -- . :(exclude,glob)__pycache__/**\nerror: open(\".venv/bin/python\"): Permission denied\nerror: unable to index file '.venv/bin/python'",
    });

    expect(failure).toContain('error: open(".venv/bin/python"): Permission denied');
    expect(failure).not.toMatch(/is not a git working tree/i);
    expect(failure).not.toMatch(/git init/i);
  });

  it("keeps git's last line when no line is a diagnosis", () => {
    const failure = describeGitFailure("/repo", {
      message: "Command failed: git add -A -- .\nsomething git printed without a prefix",
    });

    expect(failure).toContain("something git printed without a prefix");
    expect(failure).not.toContain("Command failed");
  });

  it("still reports a directory that really is not a repository as one", () => {
    const failure = describeGitFailure("/repo", {
      message: "fatal: not a git repository (or any of the parent directories): .git",
    });

    expect(failure).toMatch(/is not a git working tree/i);
  });
});
