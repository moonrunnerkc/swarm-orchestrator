import { describe, expect, it } from "vitest";
import { mutantsOfChangedLines } from "./oracle-mutants.ts";
import { pythonMutantOfLine, pythonPathSetAside } from "./python-mutants.ts";

describe("mutating one Python line", () => {
  it("inverts the first comparison, and not one inside a string or a comment", () => {
    expect(pythonMutantOfLine("a.py", 3, "    if n < 0:")?.after).toBe("    if n >= 0:");
    expect(pythonMutantOfLine("a.py", 3, "    ok = a == b")?.after).toBe("    ok = a != b");
    expect(pythonMutantOfLine("a.py", 3, '    s = "a < b"  # x < y')?.operator).toBe(
      "replace-assigned-value",
    );
    expect(pythonMutantOfLine("a.py", 3, "    if x <= y:")?.after).toBe("    if x > y:");
  });

  it("negates a condition where no comparison is there to invert", () => {
    expect(pythonMutantOfLine("a.py", 1, "if ready:")?.after).toBe("if not (ready):");
    expect(pythonMutantOfLine("a.py", 1, "    while items and open:")?.after).toBe(
      "    while not (items and open):",
    );
    expect(pythonMutantOfLine("a.py", 1, "elif done():")?.after).toBe("elif not (done()):");
  });

  it("swaps the operands of a plain subtraction, division or modulo", () => {
    expect(pythonMutantOfLine("a.py", 1, "    total = a - b")?.operator).toBe(
      "replace-assigned-value",
    );
    expect(pythonMutantOfLine("a.py", 1, "    a - b")?.after).toBe("    b - a");
    expect(pythonMutantOfLine("a.py", 1, "    f(x) / g(y)")?.after).toBe("    g(y) / f(x)");
    expect(pythonMutantOfLine("a.py", 1, "    return a - b")?.operator).toBe("return-sentinel");
  });

  it("returns None in place of a value, and assigns None in place of a value", () => {
    expect(pythonMutantOfLine("a.py", 1, "        return max(n, 0)")?.after).toBe(
      "        return None",
    );
    expect(pythonMutantOfLine("a.py", 1, "    return None")).toBeNull();
    expect(pythonMutantOfLine("a.py", 1, "    count = len(items)")?.after).toBe("    count = None");
    expect(pythonMutantOfLine("a.py", 1, "    count = None")).toBeNull();
  });

  it("leaves blank lines, definitions and imports alone", () => {
    for (const line of [
      "",
      "   ",
      "def clamp(n):",
      "import os",
      "class A:",
      "    pass",
      "    print(x)",
    ])
      expect(pythonMutantOfLine("a.py", 1, line), line).toBeNull();
  });

  it("sets test files and non-Python files aside", () => {
    expect(pythonPathSetAside("tests/test_clamp.py")).toBe(true);
    expect(pythonPathSetAside("clamp_test.py")).toBe(true);
    expect(pythonPathSetAside("conftest.py")).toBe(true);
    expect(pythonPathSetAside("src/pkg/clamp.py")).toBe(false);
    expect(pythonPathSetAside("clamp.mjs")).toBe(true);
  });

  it("is selected through the shared bound alongside JavaScript changes", () => {
    const mutants = mutantsOfChangedLines({
      changed: [
        {
          path: "src/clamp.py",
          addedLines: [
            { line: 2, text: "    if n < 0:" },
            { line: 3, text: "        return 0" },
          ],
        },
        { path: "lib/clamp.mjs", addedLines: [{ line: 2, text: "  if (n < 0) return 0;" }] },
        {
          path: "tests/test_clamp.py",
          addedLines: [{ line: 1, text: "    assert clamp(-1) == 0" }],
        },
      ],
    });
    expect(mutants.map((mutant) => mutant.id)).toEqual([
      "src/clamp.py:2:invert-comparison",
      "src/clamp.py:3:return-sentinel",
      "lib/clamp.mjs:2:invert-comparison",
    ]);
  });
});
