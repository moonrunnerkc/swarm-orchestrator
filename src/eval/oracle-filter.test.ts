import { describe, expect, it } from "vitest";
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
      'node --test "--test-name-pattern" "handles zero" __tests__/length.test.js',
    );
    expect(invocation.indexOf("--test-name-pattern")).toBeLessThan(
      invocation.indexOf("__tests__/length.test.js"),
    );
  });

  it("copies the stored test file in and runs only the named half", () => {
    const command = oracleCommand({
      storedTestFile: "/corpus/Deque.test.js",
      destination: "src/__test__/Deque.test.js",
      runner: "jest",
      runnerArgv: ["npx", "jest", "--ci", "src/__test__/Deque.test.js"],
      titles: ["holds a value"],
    });
    expect(command).toContain('cp "/corpus/Deque.test.js" src/__test__/Deque.test.js');
    // Flags before the file for every runner, not only node: one order that is correct everywhere
    // beats a per-runner rule nobody will remember.
    expect(command).toContain('npx jest --ci "-t" "holds a value" src/__test__/Deque.test.js');
  });
});
