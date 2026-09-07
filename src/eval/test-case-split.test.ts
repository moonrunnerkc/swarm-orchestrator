import { describe, expect, it } from "vitest";
import { splitTestCases, testCasesIn } from "./test-case-split.ts";

const suite = `import { describe, it, expect } from "vitest";
import { chunk } from "../src/chunk";

describe("chunk", () => {
  it("splits evenly", () => {
    expect(chunk([1, 2], 1)).toEqual([[1], [2]]);
  });

  it("keeps the remainder last", () => {
    expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });

  it("throws on a bad size", () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});
`;

describe("testCasesIn", () => {
  it("finds every top-level case with its full body", () => {
    const cases = testCasesIn(suite);
    expect(cases.map((one) => one.title)).toEqual([
      "splits evenly",
      "keeps the remainder last",
      "throws on a bad size",
    ]);
    expect(cases[0]?.source).toContain("toEqual([[1], [2]])");
  });

  // A brace inside a string or a nested closure must not end the case early, or the halves come
  // out syntactically broken and every oracle built from them fails for the wrong reason.
  it("does not end a case at a brace inside a string or a nested arrow", () => {
    const tricky = `it("handles }", () => {
  const f = () => { return "}"; };
  expect(f()).toBe("}");
});
`;
    const cases = testCasesIn(tricky);
    expect(cases).toHaveLength(1);
    expect(cases[0]?.source.trimEnd().endsWith("});")).toBe(true);
    expect(cases[0]?.source).toContain('expect(f()).toBe("}")');
  });

  it("finds nothing in a file with no cases", () => {
    expect(testCasesIn("export const x = 1;\n")).toEqual([]);
  });
});

describe("splitTestCases", () => {
  // Alternating rather than cutting in half: a suite is usually written easy cases first, so a
  // front/back cut gives one weak oracle and one strong one, and the sealed half being the weak
  // one would manufacture false greens that say more about the split than about the tool.
  it("deals the cases alternately into two halves", () => {
    const split = splitTestCases(suite);
    expect(split.sealed.map((one) => one.title)).toEqual(["splits evenly", "throws on a bad size"]);
    expect(split.heldBack.map((one) => one.title)).toEqual(["keeps the remainder last"]);
  });

  // One case cannot make two oracles, and a pair where either side is empty is not a comparison.
  it("refuses a suite with fewer than two cases", () => {
    expect(splitTestCases('it("only one", () => {});').splittable).toBe(false);
    expect(splitTestCases(suite).splittable).toBe(true);
  });
});
