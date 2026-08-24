import { describe, expect, it } from "vitest";
import { firstGitDiagnostic } from "./git-workspace.ts";

describe("what git said, and what git printed because it thought you mistyped", () => {
  /**
   * The defect this covers, seen by a person running swarm in an empty directory: `git diff`
   * outside a repository answers with one line of diagnosis and then its entire option list,
   * and execFile carries all of it on the error message. The remedy sentence ended up under a
   * hundred lines about --dirstat and --pickaxe, which is where nobody reads it.
   */
  it("keeps git's diagnosis and drops the usage block under it", () => {
    const real = new Error(
      "Command failed: git diff --no-color --no-ext-diff --unified=0 HEAD --\n" +
        "warning: Not a git repository. Use --no-index to compare two paths outside a working tree\n" +
        "usage: git diff --no-index [<options>] <path> <path>\n" +
        "\n" +
        "Diff output format options\n" +
        "    -p, --patch           generate patch\n" +
        "    -U, --unified[=<n>]   generate diffs with <n> lines context\n",
    );

    expect(firstGitDiagnostic(real)).toBe(
      "warning: Not a git repository. Use --no-index to compare two paths outside a working tree",
    );
  });

  it("prefers a fatal line, which is what a bad ref produces", () => {
    const badRef = new Error(
      "Command failed: git diff nope --\nfatal: bad revision 'nope'\nusage: git diff ...\n",
    );

    expect(firstGitDiagnostic(badRef)).toBe("fatal: bad revision 'nope'");
  });

  it("keeps the first line when git named no diagnosis at all", () => {
    expect(firstGitDiagnostic(new Error("Command failed: git diff\nusage: git diff\n"))).toBe(
      "Command failed: git diff",
    );
  });

  it("says so rather than returning an empty string when there is nothing to report", () => {
    expect(firstGitDiagnostic(new Error(""))).toBe("git produced no output");
  });
});
