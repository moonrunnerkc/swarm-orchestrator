import { describe, expect, it } from "vitest";
import { parseAuthor } from "./author-prompt.ts";
import { foreignError, raisedNotAsserted, unrelatedImport } from "./check-author.ts";

describe("an authored check failing at the base for a reason no change removes", () => {
  it("names an import of a module the base lacks and the task never asks for", () => {
    const vitest = "Error: Failed to load url ../src/index.js (resolved id: ../src/index.js)";
    expect(unrelatedImport(vitest, "Add --reviewers to parseArgs in cli")).toBe("../src/index.js");
  });

  it("allows a module the task asks for, and a name a module lacks", () => {
    const moved = "ModuleNotFoundError: No module named 'ironroot.verification.builtin_claims'";
    expect(unrelatedImport(moved, "move them into builtin_claims.py")).toBeNull();
    const export_ = "ImportError: cannot import name 'double' from 'half'";
    expect(unrelatedImport(export_, "add double")).toBeNull();
  });
});

describe("an author's reply", () => {
  it("reads the kind, the test and the claims", () => {
    const reply = 'kind: refactor\n\n```claims\n[{"path": "a.py", "contains": "def f("}]\n```';
    expect(parseAuthor(reply)).toMatchObject({
      kind: "refactor",
      claims: [{ path: "a.py", contains: "def f(" }],
      problem: null,
    });
    expect(parseAuthor("kind: feature\n```typescript\nit('x')\n```")).toMatchObject({
      kind: "feature",
      test: "it('x')\n",
    });
  });

  it("says what is wrong with one it cannot use", () => {
    expect(parseAuthor("a test")).toEqual({
      kind: null,
      problem: "the reply has no `kind: <fix|feature|...>` line",
    });
    expect(parseAuthor("kind: refactor\n```claims\n[oops\n```").problem).toMatch(/not JSON/);
  });
});

// tracemantle f69ad0c58 (replayed 2026-11-05): the author's check built ParsedSkill without its
// frontmatter, so is_template raised AttributeError at the base, and would on every correct fix.
describe("a fix's check that raises before it asserts", () => {
  const pytest = [
    "    def is_template(skill: ParsedSkill) -> bool:",
    '>       if skill.frontmatter.get("template") is True:',
    "E       AttributeError: 'ParsedSkill' object has no attribute 'frontmatter'",
    "FAILED tests/test_swarm_r1_cli.py::test_x - AttributeError: 'ParsedSkill' object has no attribute 'frontmatter'",
  ].join("\n");

  it("is named, where the wording names no crash for the fix to remove", () => {
    expect(raisedNotAsserted(pytest, "is_template reads a real skill as a template")).toBe(
      "AttributeError: 'ParsedSkill' object has no attribute 'frontmatter'",
    );
  });

  it("is not, where an assertion fails or the task is about the crash", () => {
    expect(raisedNotAsserted(`${pytest}\nE       assert False`, "x")).toBeNull();
    expect(raisedNotAsserted("AssertionError [ERR_ASSERTION]: 4 !== 2", "x")).toBeNull();
    expect(
      raisedNotAsserted(pytest, "is_template raises AttributeError on a skill with no frontmatter"),
    ).toBeNull();
  });
});

describe("a feature's check failing at the base on an error about nothing the task names", () => {
  const task = "parseArgs returns the choice as `reviewers`; a missing value is an error";
  it("is named", () => {
    const vitest =
      "FAIL  test/a.test.ts > x\nTypeError: Cannot read properties of undefined (reading 'constructor')";
    expect(foreignError(vitest, task)).toBe(
      "TypeError: Cannot read properties of undefined (reading 'constructor')",
    );
  });
  it("is not, where the error is an assertion's or about a name the task uses", () => {
    expect(
      foreignError("AssertionError: expected undefined to deeply equal [ 'a' ]", task),
    ).toBeNull();
    expect(
      foreignError("TypeError: Cannot read properties of undefined (reading 'reviewers')", task),
    ).toBeNull();
    expect(foreignError("TypeError: parseArgs is not a function", task)).toBeNull();
  });
});
