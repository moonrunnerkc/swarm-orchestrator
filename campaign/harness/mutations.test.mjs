import { describe, expect, it } from "vitest";
import { mutationOperators } from "./criteria.mjs";
import { applySite, operatorNames, sitesFor } from "./mutations.mjs";

describe("the operator list", () => {
  it("is the sealed list, in the sealed order", () => {
    expect(operatorNames).toEqual([...mutationOperators]);
  });

  it("refuses an operator that is not sealed", () => {
    expect(() => sitesFor("delete-everything", "x")).toThrow("no such mutation operator");
  });
});

describe("flip-comparison", () => {
  it("moves a boundary or flips a polarity, one per line, first match", () => {
    const sites = sitesFor("flip-comparison", "if (a < b && c === d) {\n  return x >= y;\n}\n");

    expect(sites).toEqual([
      { line: 1, before: "if (a < b && c === d) {", after: "if (a <= b && c === d) {" },
      { line: 2, before: "  return x >= y;", after: "  return x > y;" },
    ]);
  });

  it("leaves comments and arrows alone", () => {
    expect(sitesFor("flip-comparison", "// a < b\nconst f = (a) => a;\n")).toEqual([]);
  });
});

describe("off-by-one", () => {
  it("moves a plus or minus one by one more", () => {
    expect(sitesFor("off-by-one", "const last = items[items.length - 1];\nfor (i = 0; i < n + 1; i++)")).toEqual([
      { line: 1, before: "const last = items[items.length - 1];", after: "const last = items[items.length - 2];" },
      { line: 2, before: "for (i = 0; i < n + 1; i++)", after: "for (i = 0; i < n + 2; i++)" },
    ]);
  });

  it("does not touch a decimal", () => {
    expect(sitesFor("off-by-one", "x = y - 1.5\n")).toEqual([]);
  });
});

describe("negate-condition", () => {
  it("negates a braces-language condition in either spelling", () => {
    expect(sitesFor("negate-condition", "if (ready && n > 0) {")).toEqual([
      { line: 1, before: "if (ready && n > 0) {", after: "if (!(ready && n > 0)) {" },
    ]);
    expect(sitesFor("negate-condition", "\tif err != nil {")).toEqual([
      { line: 1, before: "\tif err != nil {", after: "\tif !(err != nil) {" },
    ]);
  });

  it("negates a python condition", () => {
    expect(sitesFor("negate-condition", "    if value is None:")).toEqual([
      { line: 1, before: "    if value is None:", after: "    if not (value is None):" },
    ]);
  });

  it("leaves an already negated condition alone", () => {
    expect(sitesFor("negate-condition", "if (!ready) {")).toEqual([]);
  });
});

describe("drop-early-return", () => {
  it("empties a braces block whose only statement is a return", () => {
    const text = "if (x) {\n  return a;\n}\nreturn b;\n";

    expect(sitesFor("drop-early-return", text)).toEqual([
      { line: 2, before: "  return a;", after: "" },
    ]);
  });

  it("replaces a python block's only return with pass", () => {
    expect(sitesFor("drop-early-return", "if x:\n    return a\nreturn b\n")).toEqual([
      { line: 2, before: "    return a", after: "    pass" },
    ]);
  });

  it("leaves a return that is not alone in its block", () => {
    expect(sitesFor("drop-early-return", "if (x) {\n  log();\n  return a;\n}\n")).toEqual([]);
  });
});

describe("swap-arguments", () => {
  it("swaps two plain, distinct arguments of a call", () => {
    expect(sitesFor("swap-arguments", "return clamp(value, limit);")).toEqual([
      { line: 1, before: "return clamp(value, limit);", after: "return clamp(limit, value);" },
    ]);
  });

  it("leaves definitions and same-name arguments alone", () => {
    expect(sitesFor("swap-arguments", "function clamp(value, limit) {\nf(a, a);\n")).toEqual([]);
  });
});

describe("applying a site", () => {
  it("changes exactly that line and nothing else", () => {
    const text = "a\nif (x < y) {\nb\n";
    const [site] = sitesFor("flip-comparison", text);

    expect(applySite(text, site)).toBe("a\nif (x <= y) {\nb\n");
  });

  it("refuses a site whose line no longer reads as it was found", () => {
    expect(() => applySite("changed\n", { line: 1, before: "original", after: "x" })).toThrow(
      "line 1 is not the line the site was found on",
    );
  });
});
