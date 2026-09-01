// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the inputs here are source text, and a template literal in one is the syntax under test.
import { describe, expect, it } from "vitest";
import { bindingsIn, concatenatedLiteral, substituted } from "./value-flow.ts";

describe("what the analysis reads as a binding", () => {
  it("reads a const, a let and a var", () => {
    const bindings = bindingsIn(["const a = 1;", "let b = 2;", "var c = 3;"].join("\n"));

    expect([...bindings]).toEqual([
      ["a", "1"],
      ["b", "2"],
      ["c", "3"],
    ]);
  });

  it("drops a name bound twice, because which binding reaches a use is control flow", () => {
    const bindings = bindingsIn(["let a = 1;", "let a = 2;"].join("\n"));

    expect(bindings.has("a")).toBe(false);
  });

  it("reads a shorthand destructuring pattern as one binding per field", () => {
    const bindings = bindingsIn("const { a, b } = source;");

    expect([...bindings]).toEqual([
      ["a", "source.a"],
      ["b", "source.b"],
    ]);
  });

  it("reads nothing out of a pattern that means more than one thing", () => {
    // A rename, a default, a nested pattern and a rest element each need a decision, and a
    // wrong decision here is a false positive rather than a miss.
    expect(bindingsIn("const { a: renamed } = source;").size).toBe(0);
    expect(bindingsIn("const { a = 1 } = source;").size).toBe(0);
    expect(bindingsIn("const { a: { b } } = source;").size).toBe(0);
  });

  it("reads bracket notation and dot notation as one property access", () => {
    // Changing only the brackets used to turn a value compared with itself back into an
    // assertion that counted.
    expect(substituted("v0['a']", new Map())).toBe(substituted("v0.a", new Map()));
    // A key with no dot spelling is left as written rather than invented into one.
    expect(substituted("v0['a-b']", new Map())).toBe("v0['a-b']");
  });

  it("reads nothing out of an assignment with no declaration", () => {
    expect(bindingsIn("a = 1;").size).toBe(0);
  });
});

describe("substitution", () => {
  it("replaces a bound name with what it was bound to", () => {
    const bindings = bindingsIn("const expected = v0.a;");

    expect(substituted("expected", bindings)).toBe("v0.a");
  });

  it("leaves a property name alone, because it is not the bound name", () => {
    const bindings = bindingsIn("const a = 1;");

    expect(substituted("thing.a", bindings)).toBe("thing.a");
  });

  it("resolves a chain of bindings", () => {
    const bindings = bindingsIn(["const one = v0.a;", "const two = one;"].join("\n"));

    expect(substituted("two", bindings)).toBe("v0.a");
  });

  it("stops rather than spinning on a name bound to itself", () => {
    const bindings = new Map([["a", "a + 1"]]);

    expect(substituted("a", bindings).length).toBeGreaterThan(0);
  });

  it("folds spacing so two spellings of one expression compare equal", () => {
    expect(substituted("v0 . a", new Map())).toBe(substituted("v0.a", new Map()));
  });
});

describe("reassembly", () => {
  it("joins a concatenation of two bound string literals", () => {
    const bindings = bindingsIn(['const left = "AKIA";', 'const right = "IOSFODNN7";'].join("\n"));

    expect(concatenatedLiteral("left + right", bindings)).toBe("AKIAIOSFODNN7");
  });

  it("joins a template literal built out of the same two names", () => {
    const bindings = bindingsIn(['const left = "AKIA";', 'const right = "IOSFODNN7";'].join("\n"));

    expect(concatenatedLiteral("`${left}${right}`", bindings)).toBe("AKIAIOSFODNN7");
  });

  it("keeps the literal text a template carries between its holes", () => {
    const bindings = bindingsIn(['const left = "AKIA";', 'const right = "DNN7";'].join("\n"));

    expect(concatenatedLiteral("`${left}-${right}`", bindings)).toBe("AKIA-DNN7");
  });

  it("reports nothing for a join carrying a value it cannot resolve", () => {
    // Reporting a partial join would report a value that never existed.
    const bindings = bindingsIn('const left = "AKIA";');

    expect(concatenatedLiteral("left + readKey()", bindings)).toBeNull();
  });

  it("reports nothing for an expression that is not a join at all", () => {
    expect(concatenatedLiteral('"AKIAIOSFODNN7"', new Map())).toBeNull();
  });

  it("does not split at a plus inside a string", () => {
    const bindings = bindingsIn('const sum = "a+b";');

    expect(concatenatedLiteral("sum", bindings)).toBeNull();
  });
});
