import { describe, expect, it } from "vitest";
import { globPattern } from "./held-out.ts";

describe("sealing globs", () => {
  it("lets ** cross directories and * stay inside one", () => {
    expect(globPattern("tests/hidden/**").test("tests/hidden/a/b.py")).toBe(true);
    expect(globPattern("**/*.hidden.js").test("a/b/c.hidden.js")).toBe(true);
    expect(globPattern("**/*.hidden.js").test("c.hidden.js")).toBe(true);
    expect(globPattern("tests/*.py").test("tests/a/b.py")).toBe(false);
  });

  it("matches dots literally", () => {
    expect(globPattern("a.py").test("abpy")).toBe(false);
  });
});
