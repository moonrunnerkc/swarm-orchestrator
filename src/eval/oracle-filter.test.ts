import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { oracleCommand, titleFilterFor } from "./oracle-filter.ts";

describe("titleFilterFor", () => {
  it("uses each runner's own selector", () => {
    expect(titleFilterFor("jest", ["a"])).toEqual(["-t", "a"]);
    expect(titleFilterFor("vitest", ["a"])).toEqual(["-t", "a"]);
    expect(titleFilterFor("mocha", ["a"])).toEqual(["--grep", "a"]);
    expect(titleFilterFor("node", ["a"])).toEqual(["--test-name-pattern", "a"]);
  });

  // A title is prose, so it carries parentheses and dots that mean something else in a regex.
  // Unescaped, "does not throw (regression #11.2)" selects cases nobody meant to select.
  it("escapes regex punctuation in a title", () => {
    const [, pattern] = titleFilterFor("jest", ["does not throw (regression #11.2)"]);
    expect(pattern).toBe("does not throw \\(regression #11\\.2\\)");
  });

  it("joins several titles into one alternation", () => {
    const [, pattern] = titleFilterFor("jest", ["first", "second"]);
    expect(pattern).toBe("first|second");
  });
});

describe("oracleCommand", () => {
  /**
   * `node --test a.test.mjs --test-name-pattern x` runs every test in the file: node stops reading
   * flags once a positional argument appears. Measured, on a three-test file: filter after the
   * file ran 3, filter before it ran 1.
   *
   * That silently voids the whole point of the pass. Both halves of a split are the same file
   * under a different filter, so an ignored filter makes the sealed and the held-back oracle run
   * identical tests, and the two agree by construction: the exact self-agreement the withdrawn
   * 0-of-18 number was made of.
   */
  it("puts the filter before the file, where node still reads flags", () => {
    const command = oracleCommand({
      storedTestFile: "/corpus/length.test.js",
      destination: "__tests__/length.test.js",
      runner: "node",
      runnerArgv: ["node", "--test", "__tests__/length.test.js"],
      titles: ["handles zero"],
    });
    const invocation = command.slice(command.lastIndexOf("&&") + 2).trim();
    expect(invocation).toBe(
      "node --test '--test-name-pattern' 'handles zero' '__tests__/length.test.js'",
    );
    expect(invocation.indexOf("--test-name-pattern")).toBeLessThan(
      invocation.indexOf("__tests__/length.test.js"),
    );
  });

  /**
   * A test title is prose written by somebody else, and it reaches a shell. `JSON.stringify` is
   * JSON quoting, not shell quoting: it leaves `$` alone, so koa's real title
   * `ctx.assert.${method}() should throw ...` expands to `ctx.assert.() should throw ...` and the
   * filter then matches no test at all. A backtick would be worse than wrong.
   */
  it("does not let a title expand in the shell", () => {
    const command = oracleCommand({
      storedTestFile: "/corpus/assert.test.js",
      destination: "__tests__/assert.test.js",
      runner: "jest",
      runnerArgv: ["npx", "jest", "--ci", "__tests__/assert.test.js"],
      titles: ["ctx.assert.${method}() throws", "uses `null` and $HOME"],
    });

    // Inside single quotes a POSIX shell expands nothing, so the title travels verbatim.
    // Escaped once for the regex, then wrapped in single quotes so the shell expands nothing.
    expect(command).toContain(
      "'ctx\\.assert\\.\\$\\{method\\}\\(\\) throws|uses `null` and \\$HOME'",
    );
    expect(command).not.toContain('"ctx');
  });

  it("quotes a path with a space rather than interpolating it raw", () => {
    const command = oracleCommand({
      storedTestFile: "/corpus/a b.test.js",
      destination: "tests/a b.test.js",
      runner: "jest",
      runnerArgv: ["npx", "jest", "--ci", "tests/a b.test.js"],
      titles: ["x"],
    });
    expect(command).toContain("'/corpus/a b.test.js'");
    expect(command).toContain("'tests/a b.test.js'");
  });

  it("copies the stored test file in and runs only the named half", () => {
    const command = oracleCommand({
      storedTestFile: "/corpus/Deque.test.js",
      destination: "src/__test__/Deque.test.js",
      runner: "jest",
      runnerArgv: ["npx", "jest", "--ci", "src/__test__/Deque.test.js"],
      titles: ["holds a value"],
    });
    expect(command).toContain("cp '/corpus/Deque.test.js' 'src/__test__/Deque.test.js'");
    // Flags before the file for every runner, not only node: one order that is correct everywhere
    // beats a per-runner rule nobody will remember.
    expect(command).toContain("npx jest --ci '-t' 'holds a value' 'src/__test__/Deque.test.js'");
  });
});

/**
 * The comment in oracle-filter.ts says node ignores a filter placed after the file. This runs it,
 * because the whole defect was an assumption about a runner's argument handling that nobody had
 * executed. A comment cannot notice when node changes; this can.
 */
describe("what node actually does with a trailing filter", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "oracle-filter-"));
    await writeFile(
      join(directory, "three.test.mjs"),
      [
        'import { test } from "node:test";',
        'test("alpha one", () => {});',
        'test("beta two", () => {});',
        'test("gamma three", () => {});',
        "",
      ].join("\n"),
    );
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const ran = (output: string) => Number(/^. tests (\d+)$/m.exec(output)?.[1] ?? "-1");

  const runNode = (args: readonly string[]) =>
    new Promise<string>((resolve) => {
      const child = spawn(process.execPath, [...args], { cwd: directory });
      let out = "";
      child.stdout.on("data", (chunk) => {
        out += chunk;
      });
      child.on("close", () => resolve(out));
    });

  it("ignores the filter after the file, and honours it before", async () => {
    const after = await runNode(["--test", "three.test.mjs", "--test-name-pattern", "alpha one"]);
    const before = await runNode(["--test", "--test-name-pattern", "alpha one", "three.test.mjs"]);

    expect(ran(after)).toBe(3);
    expect(ran(before)).toBe(1);
  }, 30_000);
});
