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
    expect(findBacktrackingRisk("(a+)X(a+)$")).toBeNull();
  });

  it("accepts captures whose quantifiers cannot take each other's characters", () => {
    // Reading through groups must not cost the ordinary two-capture search.
    expect(findBacktrackingRisk(String.raw`(\w+)\s(\w+)`)).toBeNull();
    expect(findBacktrackingRisk(String.raw`(\d+)-(\d+)`)).toBeNull();
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

  /**
   * A capture is not a boundary. This family reached a real search through the guard once,
   * because the neighbour scan only looked at bare quantifiers and `(a+)` is a group; it is
   * the same ambiguity as `a+a+` with parentheses drawn around it. The earlier suite tested
   * only the bare spelling, which is why nothing caught it.
   */
  for (const pattern of [
    "(a+)(a+)$",
    "(a+)(a*)$",
    String.raw`(\w+)(\w+)$`,
    String.raw`(\s*)(\s*)$`,
    "((a+))((a+))$",
  ]) {
    it(`refuses ${pattern}, the same competition with parentheses drawn round it`, () => {
      expect(findBacktrackingRisk(pattern)).not.toBeNull();
    });
  }

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

/**
 * The octal normalization, the 256-code-unit probe alphabet, and the fail-closed empty
 * probe shipped together with no dedicated test. This is the lesson the grouped-spelling
 * miss already taught, written down: an untested guard spelling is the live one, and every
 * family below is a spelling of a rule the suite above already covers in ASCII.
 */
describe("competing quantifiers spelled as octal escapes", () => {
  /**
   * `\141` is `a`, so each of these is a pattern the suite above refuses, retyped. The
   * engine decides `\` plus digits is an octal escape rather than a backreference by
   * counting capture groups, so a reader that skipped the digits would see two atoms it
   * could not compare and clear the pattern.
   */
  for (const [pattern, plain] of [
    [String.raw`\141+\141+X`, "a+a+X"],
    [String.raw`(\141+)+$`, "(a+)+$"],
    [String.raw`(\141|\141)+$`, "(a|a)+$"],
    [String.raw`(\141+)(\141+)$`, "(a+)(a+)$"],
  ] as const) {
    it(`refuses ${pattern}, which is ${plain}`, () => {
      expect(findBacktrackingRisk(pattern)).not.toBeNull();
    });
  }

  it("refuses a two-digit and a one-digit octal the same way", () => {
    expect(findBacktrackingRisk(String.raw`\60+\60+X`)).not.toBeNull();
    expect(findBacktrackingRisk(String.raw`\0+\0+X`)).not.toBeNull();
  });

  it("compares an octal atom against a literal one, not only against another octal", () => {
    expect(findBacktrackingRisk(String.raw`\141+a+X`)).not.toBeNull();
  });

  /**
   * The other direction, and the one that says the normalization decodes rather than
   * refusing anything with a backslash in it: `\141` and `\142` are `a` and `b`, which
   * cannot take each other's characters, so this is an ordinary search.
   */
  it("accepts two octal atoms that are genuinely disjoint", () => {
    expect(findBacktrackingRisk(String.raw`\141+\142+X`)).toBeNull();
  });

  /**
   * Only the escape is consumed. `\18` is `\x01` followed by a literal `8`, so the `+`
   * binds to the `8` and the two `8+` runs are held apart by the `\x01` between them.
   * Consuming the trailing digit into the escape would bind the quantifier somewhere the
   * engine does not.
   */
  it("leaves a digit past the escape as its own quantified character", () => {
    expect(findBacktrackingRisk(String.raw`\18+\18+X`)).toBeNull();
  });
});

describe("atoms that only match non-printable code units", () => {
  /**
   * The probe alphabet runs the whole 256-code-unit range rather than the printable part
   * of it, because a control character is a character a quantifier can pump over. An
   * alphabet that started at 0x20 would read every atom here as matching nothing.
   */
  it("refuses two quantifiers over the same control character", () => {
    expect(findBacktrackingRisk(String.raw`\x01+\x01+X`)).not.toBeNull();
  });

  it("refuses two quantifiers over the same control-character class", () => {
    expect(findBacktrackingRisk(String.raw`[\x00-\x08]+[\x00-\x08]+X`)).not.toBeNull();
  });

  /**
   * `\1` with no capture group to refer to is the octal escape `\x01`, so this is
   * `\x01+\x01+\x01+X`: the case the disjointness comment names, and one that needs the
   * octal decode and the non-printable probe together to be seen at all.
   */
  it("refuses a backreference-shaped octal repeated over itself", () => {
    expect(findBacktrackingRisk(String.raw`\1+\1+\1+X`)).not.toBeNull();
  });
});

describe("an atom no probe matches fails closed", () => {
  /**
   * Disjointness is the answer that lets a pattern run, so it is never the answer given by
   * default. An atom the probe alphabet cannot decide is undecided, and undecided has to
   * read as overlapping: reading it as matching nothing would clear the pattern on the
   * strength of not having understood it.
   */
  it("refuses quantifiers over an atom that matches nothing at all", () => {
    expect(findBacktrackingRisk(String.raw`[^\s\S]+[^\s\S]+X`)).not.toBeNull();
    expect(findBacktrackingRisk(String.raw`([^\s\S]+)+$`)).not.toBeNull();
  });

  it("refuses quantifiers over an atom outside the probed range", () => {
    // Fullwidth forms: no probe in the alphabet matches them, so nothing is decided.
    expect(findBacktrackingRisk("[\uFF01-\uFF5E]+[\uFF01-\uFF5E]+X")).not.toBeNull();
  });

  /**
   * The cost of failing closed, pinned so it stays a decision. These two atoms are
   * genuinely disjoint and the pattern is safe, and it is refused anyway because one of
   * them is unprobed. Refusing a safe search is the direction this is allowed to be wrong
   * in; clearing an unsafe one is not.
   */
  it("refuses an unprobed atom beside a probed one, which is the false positive it accepts", () => {
    expect(findBacktrackingRisk("[\uFF01-\uFF5E]+a+X")).not.toBeNull();
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
