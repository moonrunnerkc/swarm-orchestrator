import { describe, expect, it } from "vitest";
import { findBacktrackingRisk } from "./regex-safety.ts";

/**
 * The refusal is a security boundary: the search tool runs a model-supplied pattern per
 * line on the main thread, and a match already in flight cannot be interrupted. So both
 * directions are pinned here. Loosening the reader lets a catastrophic pattern through;
 * tightening it breaks ordinary search, which is the pressure that would loosen it again.
 */

/** Patterns a person would plausibly search a codebase with. */
const ordinary = [
  "TODO",
  "TODO|FIXME|XXX",
  String.raw`function \w+`,
  "^import .* from",
  String.raw`\bclass\s+[A-Z]\w*`,
  "error|warning",
  String.raw`\d{4}-\d{2}-\d{2}`,
  "foo.*bar",
  String.raw`[a-z]+@[a-z]+\.[a-z]+`,
  String.raw`export (const|function) \w+`,
  String.raw`\s*//.*$`,
  String.raw`^\s*it\(`,
];

/** Shapes whose failing match is super-linear, one per rule the reader implements. */
const catastrophic = [
  "(a+)+$",
  "(a*)*$",
  "([a-z]+)*$",
  String.raw`(\w+\s)*$`,
  String.raw`^(\w+\s?)*$`,
  "(a?)+$",
  "(a|a)+$",
  "(a|ab)+$",
  String.raw`\s*\s*$`,
  "a+a+$",
];

describe("patterns a search can run", () => {
  for (const pattern of ordinary) {
    it(`accepts ${pattern}`, () => {
      expect(findBacktrackingRisk(pattern)).toBeNull();
    });
  }

  it("accepts alternatives that decide themselves on the first character", () => {
    expect(findBacktrackingRisk("(get|got)+")).toBeNull();
    expect(findBacktrackingRisk("(ab|cd)+")).toBeNull();
  });

  it("accepts two quantifiers a mandatory character keeps apart", () => {
    // The X pins the boundary, so neither quantifier can take the other's characters.
    expect(findBacktrackingRisk("a+Xa+")).toBeNull();
    expect(findBacktrackingRisk(String.raw`\d+\s+`)).toBeNull();
  });

  it("accepts a quantifier that cannot repeat more than once", () => {
    expect(findBacktrackingRisk("(a+){1}")).toBeNull();
  });

  it("accepts a lookahead over an atom, which consumes nothing to pump", () => {
    expect(findBacktrackingRisk("(?=a)b")).toBeNull();
  });
});

describe("patterns that can backtrack super-linearly", () => {
  for (const pattern of catastrophic) {
    it(`refuses ${pattern}`, () => {
      expect(findBacktrackingRisk(pattern)).not.toBeNull();
    });
  }

  it("refuses nesting however the inner group is spelled", () => {
    expect(findBacktrackingRisk("(?:a+)+")).not.toBeNull();
    expect(findBacktrackingRisk("(?<name>a+)+")).not.toBeNull();
  });

  it("refuses a counted outer quantifier, which repeats just as ambiguously", () => {
    expect(findBacktrackingRisk("(a+){2}")).not.toBeNull();
  });

  it("refuses competing alternatives one level below the quantifier", () => {
    expect(findBacktrackingRisk("((a|ab)y)+$")).not.toBeNull();
  });

  it("reads inside a lookaround rather than trusting it", () => {
    expect(findBacktrackingRisk("(?=(a+)+)b")).not.toBeNull();
  });
});

describe("patterns it cannot read", () => {
  /** An unread pattern is one nothing bounds, so it is refused rather than run. */
  for (const pattern of ["(", "a\\", "(?#comment)a", "[a-z"]) {
    it(`refuses ${JSON.stringify(pattern)} rather than guessing`, () => {
      const risk = findBacktrackingRisk(pattern);
      expect(risk?.reason).toContain("could not be read structurally");
    });
  }
});

describe("what a refusal says", () => {
  it("names the construct carrying the risk, quoted from the pattern", () => {
    const risk = findBacktrackingRisk("^prefix (a+)+ suffix$");

    expect(risk).not.toBeNull();
    expect(risk?.construct).toBe("(a+)+");
    expect(risk?.reason.length).toBeGreaterThan(0);
  });

  it("quotes both quantifiers when they compete in sequence", () => {
    expect(findBacktrackingRisk(String.raw`\s*\s*$`)?.construct).toBe(String.raw`\s*\s*`);
  });
});

describe("limits this reader is known to have", () => {
  /**
   * Ambiguity a backreference introduces is invisible to a structural read, since what the
   * reference matches is only known at match time. Recorded so the gap is a decision rather
   * than a surprise: the line-length cap in the search tool is what bounds this one.
   */
  it("does not see ambiguity introduced by a backreference", () => {
    expect(findBacktrackingRisk(String.raw`(\w+)\1$`)).toBeNull();
  });
});
