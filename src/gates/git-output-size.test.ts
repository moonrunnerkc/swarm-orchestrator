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

  it("still reports a directory that really is not a repository as one", () => {
    const failure = describeGitFailure("/repo", {
      message: "fatal: not a git repository (or any of the parent directories): .git",
    });

    expect(failure).toMatch(/is not a git working tree/i);
  });
});
