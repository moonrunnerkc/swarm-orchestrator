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
  it("copies the stored test file in and runs only the named half", () => {
    const command = oracleCommand({
      storedTestFile: "/corpus/Deque.test.js",
      destination: "src/__test__/Deque.test.js",
      runner: "jest",
      runnerArgv: ["npx", "jest", "--ci", "src/__test__/Deque.test.js"],
      titles: ["holds a value"],
    });
    expect(command).toContain('cp "/corpus/Deque.test.js" src/__test__/Deque.test.js');
    expect(command).toContain('npx jest --ci src/__test__/Deque.test.js "-t" "holds a value"');
  });
});
