import { describe, expect, it } from "vitest";
import type { JsonValue } from "./canonical-json.ts";
import { evaluatePredicate, PredicateParseError, parsePredicate } from "./predicate.ts";

const testRun: JsonValue = {
  tests: { collected: 47, failed: 0, skipped: 2, suite: "vitest" },
  facts: { exitCode: 0, stdoutBytes: 812 },
  ok: true,
};

function evaluate(source: string, subject: JsonValue = testRun) {
  return evaluatePredicate(parsePredicate(source), subject);
}

describe("predicate evaluation", () => {
  it("evaluates the shape a claim is expected to carry", () => {
    expect(evaluate("tests.failed == 0 && tests.collected >= 47")).toEqual({
      ok: true,
      value: true,
    });
  });

  it("reports false when the record does not support the numbers", () => {
    expect(evaluate("tests.collected >= 48")).toEqual({ ok: true, value: false });
    expect(evaluate("tests.failed == 0 && tests.collected >= 48")).toEqual({
      ok: true,
      value: false,
    });
  });

  it("handles every comparison operator", () => {
    expect(evaluate("tests.skipped != 0")).toEqual({ ok: true, value: true });
    expect(evaluate("tests.skipped > 1")).toEqual({ ok: true, value: true });
    expect(evaluate("tests.skipped < 1")).toEqual({ ok: true, value: false });
    expect(evaluate("tests.skipped <= 2")).toEqual({ ok: true, value: true });
    expect(evaluate('tests.suite == "vitest"')).toEqual({ ok: true, value: true });
    expect(evaluate("ok == true")).toEqual({ ok: true, value: true });
  });

  it("takes || and parentheses", () => {
    expect(evaluate("tests.failed == 9 || tests.collected == 47")).toEqual({
      ok: true,
      value: true,
    });
    expect(evaluate("(tests.failed == 0 || tests.failed == 1) && ok == true")).toEqual({
      ok: true,
      value: true,
    });
  });

  it("indexes into arrays by position", () => {
    expect(evaluate('gates.0.name == "lint"', { gates: [{ name: "lint" }] })).toEqual({
      ok: true,
      value: true,
    });
  });

  it("reports a path that does not exist rather than calling the claim false", () => {
    expect(evaluate("tests.passed == 47")).toEqual({
      ok: false,
      failure: "path-not-found",
      detail: "tests.passed does not exist in the cited record",
    });
  });

  it("surfaces a broken path even on the side a false conjunction would skip", () => {
    // Short-circuiting here would report "false" and hide that the claim cites a
    // field the record has never had.
    expect(evaluate("tests.collected >= 999 && tests.passed == 1").ok).toBe(false);
  });

  it("refuses to order values that are not numbers", () => {
    expect(evaluate('tests.suite > "a"')).toMatchObject({ ok: false, failure: "type-mismatch" });
    expect(evaluate("tests == 1")).toMatchObject({ ok: false, failure: "type-mismatch" });
  });
});

describe("predicate parsing", () => {
  it("rejects an empty or malformed predicate with a usable message", () => {
    expect(() => parsePredicate("")).toThrow(PredicateParseError);
    expect(() => parsePredicate("tests.failed")).toThrow(/expected one of/);
    expect(() => parsePredicate("tests.failed == ")).toThrow(/value was expected/);
    expect(() => parsePredicate("(tests.failed == 0")).toThrow(/never closed/);
    expect(() => parsePredicate("tests.failed == 0 && ")).toThrow(PredicateParseError);
  });

  it("rejects anything that is not a comparison, including bare truthiness", () => {
    expect(() => parsePredicate("true")).toThrow(PredicateParseError);
    expect(() => parsePredicate("tests.failed = 0")).toThrow(PredicateParseError);
    expect(() => parsePredicate("drop table tests")).toThrow(PredicateParseError);
  });
});
