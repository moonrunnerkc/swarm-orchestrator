import { describe, expect, it } from "vitest";
import { splitTestCases, testCaseDeals, testCasesIn } from "./test-case-split.ts";

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

describe("testCaseDeals", () => {
  const four = `it("a", () => {});
it("b", () => {});
it("c", () => {});
it("d", () => {});
`;

  // The alternating deal is still the one to prefer, for the reason it was chosen: it gives both
  // halves the same mix of easy and edge cases. The others exist only for when it produces a half
  // that passes on the base source, which is a half that can accept a patch changing nothing.
  it("offers the alternating deal first", () => {
    const deals = testCaseDeals(four);
    expect(deals[0]?.sealed.map((one) => one.title)).toEqual(["a", "c"]);
    expect(deals[0]?.heldBack.map((one) => one.title)).toEqual(["b", "d"]);
  });

  // Where every case that fails on the base sits at an even index, the alternating deal puts all
  // of them in one half and the other half specifies nothing. Dealing in larger blocks moves a
  // different set of cases across, which is the only way a re-deal can change that answer.
  it("re-deals in blocks, so a half that passed on the base gets different cases", () => {
    const deals = testCaseDeals(four);
    expect(deals[1]?.sealed.map((one) => one.title)).toEqual(["a", "b"]);
    expect(deals[1]?.heldBack.map((one) => one.title)).toEqual(["c", "d"]);
    expect(deals[2]?.sealed.map((one) => one.title)).toEqual(["a", "b", "c"]);
    expect(deals[2]?.heldBack.map((one) => one.title)).toEqual(["d"]);
  });

  // A half with no cases in it is not an oracle: the runner matches nothing, exits zero, and the
  // task reads as accepted by a check that never ran.
  it("never offers a deal with an empty half", () => {
    const deals = testCaseDeals(`it("a", () => {});\nit("b", () => {});\n`);
    expect(deals).toHaveLength(1);
    expect(deals.every((deal) => deal.sealed.length > 0 && deal.heldBack.length > 0)).toBe(true);
  });

  // Each deal costs two runs of the suite on the base source, paid at mining time on every
  // candidate. The bound is what keeps that from growing with the size of the test file.
  it("offers no more than three deals however many cases there are", () => {
    const many = Array.from({ length: 12 }, (_, at) => `it("t${at}", () => {});`).join("\n");
    expect(testCaseDeals(many)).toHaveLength(3);
  });

  it("offers nothing where there is only one case", () => {
    expect(testCaseDeals('it("only one", () => {});')).toEqual([]);
  });
});
