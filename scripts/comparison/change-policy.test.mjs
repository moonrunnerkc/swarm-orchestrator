import { describe, expect, it } from "vitest";
import { swarmContract, taskPrompt } from "./arms.mjs";
import {
  changePolicyVerdict,
  countAssertions,
  isTestFile,
  parsePatch,
  policyLines,
  protectedPaths,
} from "./change-policy.mjs";
import { tasks } from "./tasks.mjs";

const minimatch = tasks.find((task) => task.id === "minimatch-bugfix-partial-globstar");

const basePackage = JSON.stringify({
  name: "lib",
  scripts: { test: "tap", pretest: "npm run prepare" },
  devDependencies: { tap: "^21" },
});

/** A verdict over a patch with an in-memory base and after-tree, package.json only. */
const judge = (patch, { after = basePackage, base = basePackage } = {}) =>
  changePolicyVerdict(patch, minimatch, {
    readBase: async (path) => (path === "package.json" ? base : null),
    readAfter: async (path) => (path === "package.json" ? after : null),
  });

const diff = (path, { status = "modified", removed = [], added = [], oldPath = path } = {}) =>
  [
    `diff --git a/${oldPath} b/${path}`,
    status === "added"
      ? "new file mode 100644"
      : status === "deleted"
        ? "deleted file mode 100644"
        : "index 0000000..1111111 100644",
    `--- ${status === "added" ? "/dev/null" : `a/${oldPath}`}`,
    `+++ ${status === "deleted" ? "/dev/null" : `b/${path}`}`,
    "@@ -1,1 +1,1 @@",
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
    "",
  ].join("\n");

const sourceChange = diff("src/index.ts", {
  removed: ["      if (tail.length + fileIndex > file.length) return false"],
  added: ["      if (tail.length + fileIndex > file.length) return partial"],
});

describe("what the policy tells both arms", () => {
  it("permits regression tests and names what is protected, in the same words for each arm", () => {
    const lines = policyLines(minimatch);
    expect(lines[0]).toContain("regression tests for the change");
    expect(lines[1]).toBe("Do not modify anything under acceptance/visible/.");
    expect(taskPrompt(minimatch)).toContain(lines.join("\n"));
    // OpenCode's prompt and Swarm's prompt are one function; Swarm's contract adds the same paths.
    expect(swarmContract(minimatch).immutablePaths).toEqual(protectedPaths(minimatch));
    expect(protectedPaths(minimatch)).not.toContain("test");
    expect(protectedPaths(minimatch)).toContain("acceptance/visible");
    expect(protectedPaths(minimatch)).toContain(".taprc");
  });

  it("never freezes a test directory for a hidden test that will be overlaid there", () => {
    for (const task of tasks)
      for (const hidden of task.hidden.testFiles)
        expect(
          protectedPaths(task).some((root) => hidden === root || hidden.startsWith(`${root}/`)),
          `${task.id}: ${hidden}`,
        ).toBe(false);
  });
});

describe("what the policy accepts", () => {
  it("accepts a source change with a new test file", async () => {
    const verdict = await judge(
      sourceChange +
        diff("test/partial-globstar.ts", {
          status: "added",
          added: [
            "import t from 'tap'",
            "import { minimatch as mm } from '../src/index.js'",
            "t.equal(mm('/b/c/d/a', '/**/a/b/c', { partial: true }), true)",
            "t.equal(mm('b/a', 'a/**', { partial: true }), false)",
          ],
        }),
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.addedAssertions).toBe(2);
    expect(verdict.testFilesAdded).toEqual(["test/partial-globstar.ts"]);
  });

  it("accepts new cases appended to an existing test file", async () => {
    const verdict = await judge(
      sourceChange +
        diff("test/partial.js", { added: ["t.equal(mm('a', 'a/**', { partial: true }), true)"] }),
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.testFilesTouched).toEqual(["test/partial.js"]);
  });

  it("accepts a test file moved or rewritten when its assertions are kept, as the upstream reference did", async () => {
    const verdict = await judge(
      sourceChange +
        diff("test/partial.js", {
          status: "deleted",
          removed: [
            "t.equal(mm('/a/b', '/*/b/x/y/z', { partial: true }), true)",
            "t.equal(mm.makeRe('x', { partial: true }).test('/'), true)",
          ],
        }) +
        diff("test/partial.ts", {
          status: "added",
          added: [
            "t.equal(mm('/a/b', '/*/b/x/y/z', { partial: true }), true)",
            "t.equal((mm.makeRe('x', { partial: true }) as MMRegExp).test('/'), true)",
            "t.equal(mm('a', '**', { partial: true }), true)",
          ],
        }),
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.removedAssertions).toBe(2);
    expect(verdict.addedAssertions).toBe(3);
  });

  it("accepts a package.json change that leaves the checks alone", async () => {
    const after = JSON.stringify({
      ...JSON.parse(basePackage),
      devDependencies: { tap: "^21", extra: "1.0.0" },
    });
    const verdict = await judge(diff("package.json", { added: ['    "extra": "1.0.0"'] }), {
      after,
    });
    expect(verdict.ok).toBe(true);
  });
});

describe("what the policy rejects, by name", () => {
  it("rejects a change to the visible check or to a runner configuration file", async () => {
    const verdict = await judge(
      diff("acceptance/visible/check.mjs", { added: ["// loosened"] }) +
        diff(".taprc", { status: "added", added: ["allow-incomplete-coverage: true"] }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.map((one) => `${one.rule} ${one.path}`)).toEqual([
      "protected-path acceptance/visible/check.mjs",
      "protected-path .taprc",
    ]);
  });

  it("rejects deleted assertions that are not added back", async () => {
    const verdict = await judge(
      diff("test/partial.js", {
        removed: ["t.equal(mm('/a/b/c', '/*/b/x/y/z', { partial: true }), false)"],
        added: ["// removed: this case was wrong"],
      }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.violations[0]).toMatchObject({ rule: "assertions-removed" });
  });

  it("rejects a skip, only or todo marker added to a test", async () => {
    for (const line of [
      "t.test('partial', { skip: true }, (t) => {",
      "  t.skip('partial globstar')",
      "it.only('still runs', () => {})",
      "xit('used to run', () => {})",
    ]) {
      const verdict = await judge(diff("test/partial.js", { added: [line] }));
      expect(verdict.ok, line).toBe(false);
      expect(verdict.violations[0]?.rule, line).toBe("skip-marker");
    }
  });

  it("rejects a coverage exclusion wherever it is added", async () => {
    for (const line of [
      "/* c8 ignore next */",
      "/* istanbul ignore else */",
      "/* node:coverage disable */",
    ]) {
      const verdict = await judge(diff("src/index.ts", { added: [line] }));
      expect(verdict.ok, line).toBe(false);
      expect(verdict.violations[0]?.rule, line).toBe("coverage-exclusion");
    }
  });

  it("rejects an altered test script or runner section in package.json", async () => {
    const after = JSON.stringify({
      ...JSON.parse(basePackage),
      scripts: { test: "tap --disable-coverage", pretest: "npm run prepare" },
      tap: { "allow-incomplete-coverage": true },
    });
    const verdict = await judge(
      diff("package.json", { added: ['    "test": "tap --disable-coverage"'] }),
      {
        after,
      },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.map((one) => one.rule)).toEqual([
      "check-configuration",
      "check-configuration",
    ]);
    expect(verdict.violations[0]?.detail).toContain("scripts.test");
    expect(verdict.violations[1]?.detail).toContain("tap changed");
  });
});

describe("reading patches and tests", () => {
  it("reads file status, paths and changed lines from a unified diff", () => {
    const files = parsePatch(
      diff("a.js", { status: "deleted", removed: ["x"] }) +
        diff("b.js", { status: "added", added: ["y"] }) +
        diff("d.js", { oldPath: "c.js", added: ["z"] }),
    );
    expect(files.map((file) => [file.oldPath, file.path, file.status])).toEqual([
      ["a.js", "a.js", "deleted"],
      ["b.js", "b.js", "added"],
      ["c.js", "d.js", "modified"],
    ]);
    expect(files[0].removed).toEqual(["x"]);
    expect(files[2].added).toEqual(["z"]);
  });

  it("knows a test file by directory or by suffix", () => {
    for (const path of ["test/a.ts", "spec/b_spec.js", "src/__tests__/c.js", "lib/d.test.mjs"])
      expect(isTestFile(path), path).toBe(true);
    for (const path of ["src/index.ts", "testing/notes.md", "lib/contest.js"])
      expect(isTestFile(path), path).toBe(false);
  });

  it("counts assertions and not structure", () => {
    expect(countAssertions("t.equal(a, b); t.ok(c)")).toBe(2);
    expect(countAssertions("t.test('x', (t) => { t.plan(2) })")).toBe(0);
    expect(countAssertions("expect(x).toBe(1); assert(y); assert.strictEqual(a, b)")).toBe(3);
    expect(countAssertions("const expectation = compute(); describe('x')")).toBe(0);
    // tap's subtest handles and referee's assert and refute, as dotenv and sinon write them.
    expect(countAssertions("ct.same(dotenv.parse(src), expected, label)")).toBe(1);
    expect(
      countAssertions("refute.exception(() => object.method()); assert(stub.getter.calledThrice)"),
    ).toBe(2);
  });
});
