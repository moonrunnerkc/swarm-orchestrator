import { describe, expect, it } from "vitest";
import denials from "./fixtures/inline-program-denials-2026-10-20.json" with { type: "json" };
import { createPolicyGuard } from "./policy-guard.ts";
import { readShellCommand } from "./shell-command.ts";

/**
 * The four shell calls the policy guard denied during the Swarm launch of 2026-10-20 on
 * minimatch (ledger 20261020T233810-339b33, records 405, 423, 441 and 527), verbatim. Each was a
 * `node -e` program probing the library in the workspace, and each denial named an absolute
 * path that appears only in a comment of the program: `/a/b`, `/a/b/c` and `/b/c/d/a` are the
 * example paths the task text uses, written into comments while the model reasoned about them.
 * The reader offered the comment's words as paths; the guard resolved them outside the
 * workspace; the probe never ran.
 */
const workspace =
  "/Users/brad/swarm-comparison-work/minimatch-bugfix-partial-globstar.swarm-sAJOSf/workspace";
const guard = createPolicyGuard({
  workspaceRoot: workspace,
  homeDir: "/Users/brad",
  childHomeDir: "/tmp/swarm-test-child-home",
  shellAllowlist: ["node"],
  deniedRoots: [],
  realpath: (path) => path,
});

/** What the chokepoint does with a shell call: every offered operand through the guard, first refusal wins. */
function firstDenial(command: string): string | null {
  const read = readShellCommand(command);
  if (read === null) return "unreadable";
  for (const operand of read.operands) {
    const verdict = guard.checkPath(operand);
    if (!verdict.allowed) return verdict.reason;
  }
  return null;
}

/** Whether a whitespace-separated word occurs in the program outside its `//` comments. */
function namedOutsideComments(code: string, word: string): boolean {
  const withoutComments = code
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
  return withoutComments.split(/\s+/).includes(word);
}

describe("the recorded inline-program denials of 2026-10-20", () => {
  it("were each denied on a word that only a comment of the program carried", () => {
    for (const denial of denials) {
      expect(denial.decision).toBe("denied");
      expect(denial.denial).toBe("guard");
      const deniedPath = denial.detail.split(" resolves outside the workspace ")[0] ?? "";
      expect(deniedPath).not.toBe("");
      // The recorded command names that path as a whitespace-separated piece of the program...
      expect(denial.command.split(/\s+/)).toContain(deniedPath);
      // ...and only inside a `//` comment: nowhere in the code itself.
      expect(namedOutsideComments(denial.command, deniedPath), String(denial.sequence)).toBe(false);
    }
  });

  it("are allowed now, with their comments read as comments and the rest still checked", () => {
    for (const denial of denials) {
      expect(firstDenial(denial.command), `record ${denial.sequence}`).toBeNull();
      // The program's own module path is still offered to the guard, and is inside the workspace.
      expect(readShellCommand(denial.command)?.operands).toContain("./dist/commonjs/index.js");
    }
  });

  it("still denies the same program when the outside path is in code rather than in a comment", () => {
    const first = denials[0];
    if (first === undefined) throw new Error("the fixture is empty");
    const command = first.command.replace(
      "require('./dist/commonjs/index.js');",
      "require('./dist/commonjs/index.js'); require('fs').readFileSync('../../../.ssh/id_rsa');",
    );
    expect(firstDenial(command)).toContain("resolves outside the workspace");
  });
});
