import { describe, expect, it } from "vitest";
import {
  assertsIdentity,
  bindingsIn,
  reassembledStrings,
  resolveExpression,
} from "./value-flow.ts";

describe("what a name was bound to", () => {
  it("follows const, let and var", () => {
    const bindings = bindingsIn("const a = 1;\nlet b = 'x';\nvar c = subject.total;");

    expect([...bindings]).toEqual([
      ["a", "1"],
      ["b", "'x'"],
      ["c", "subject.total"],
    ]);
  });

  it("drops a name bound twice, because which one an occurrence means is not read here", () => {
    expect(bindingsIn("const a = 1;\nconst a = 2;").has("a")).toBe(false);
  });

  it("drops a binding that mentions itself, which resolves to nothing this can follow", () => {
    expect(bindingsIn("let a = a + 1;").has("a")).toBe(false);
  });

  it("substitutes to a fixed point through a chain of inert bindings", () => {
    const bindings = bindingsIn("const a = subject;\nconst b = a;");

    expect(resolveExpression("b.total", bindings)).toBe("subject.total");
  });

  it("leaves a name bound to something it cannot evaluate as the name it was written as", () => {
    const bindings = bindingsIn("const built = make(1, 2);");

    expect(resolveExpression("built.total", bindings)).toBe("built.total");
  });
});

describe("a comparison that reduces to itself", () => {
  const none = bindingsIn("");

  it("is recognized over a property read", () => {
    expect(assertsIdentity("expect(v0.a).toBe(v0.a);", none)).toBe(true);
  });

  it("is recognized after a rename", () => {
    const bindings = bindingsIn("const seen = v0;");

    expect(assertsIdentity("expect(seen.a).toBe(v0.a);", bindings)).toBe(true);
  });

  it("is recognized in the node assertion spelling", () => {
    expect(assertsIdentity("assert.strictEqual(v0.a, v0.a);", none)).toBe(true);
  });

  it("is not claimed where either side contains a call", () => {
    // A memoization test compares two calls and is a real assertion about identity.
    expect(assertsIdentity("expect(cache.get('k')).toBe(cache.get('k'));", none)).toBe(false);
    expect(assertsIdentity("expect(build()).toBe(build());", none)).toBe(false);
  });

  it("is not claimed where the two sides are different expressions", () => {
    expect(assertsIdentity("expect(v0.a).toBe(v0.b);", none)).toBe(false);
    expect(assertsIdentity("expect(v0.a).toBe(1);", none)).toBe(false);
  });

  it("is not claimed on a matcher that is not an equality", () => {
    expect(assertsIdentity("expect(v0.a).toContain(v0.a);", none)).toBe(false);
  });
});

describe("a string a concatenation builds", () => {
  it("resolves the pieces through their bindings", () => {
    const found = reassembledStrings(
      "const head = 'AKIA';\nconst tail = 'IOSFODNN7EXAMPLE';\nconst v = head + tail;",
    );

    expect(found.map((one) => one.value)).toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("resolves a chain of literals written inline", () => {
    expect(reassembledStrings("const v = 'gh' + 'p_' + 'abc';").map((one) => one.value)).toContain(
      "ghp_abc",
    );
  });

  it("produces nothing where a piece is not a literal", () => {
    expect(reassembledStrings("const v = 'AKIA' + suffix;")).toEqual([]);
  });

  it("claims every piece, so redacting the join does not leave a half in the clear", () => {
    const text = "const head = 'AKIA';\nconst v = head + 'rest';";
    const [found] = reassembledStrings(text);

    expect(found?.spans.length).toBeGreaterThan(1);
    for (const span of found?.spans ?? []) {
      expect(text.slice(span.start, span.end).length).toBeGreaterThan(0);
    }
  });
});
