import { describe, expect, it } from "vitest";
import { closureOf, harnessesDifferWhereItMatters } from "./verification-closure.ts";

describe("which files a verdict actually came out of", () => {
  /**
   * Walked from the entry point rather than listed, because a list goes stale the moment somebody
   * adds an import and nothing tells you.
   */
  it("walks the imports of the file that computes a verdict", () => {
    const closure = closureOf("src/gates/independent-verification.ts");

    expect(closure).toContain("src/gates/independent-verification.ts");
    expect(closure).toContain("src/gates/certification.ts");
    expect(closure).toContain("src/gates/oracle-mutants.ts");
    expect(closure).toContain("src/gates/mutant-witness.ts");
  });

  it("leaves out what a verdict does not read", () => {
    const closure = closureOf("src/gates/independent-verification.ts");

    expect(closure).not.toContain("src/cli.ts");
    expect(closure).not.toContain("src/eval/false-green-rate.ts");
    expect(closure).not.toContain("src/evidence/verifier/rederive.mjs");
  });
});

/**
 * Two commits are the same tool where nothing a verdict reads differs between them.
 *
 * The guard this replaces compared commit ids, so a documentation commit between two corpus
 * stages made the rate "span tool versions" and refused to be quoted. That is the right instinct
 * and the wrong test: what must not be pooled is rows produced by different verification code, and
 * a commit id answers a different question.
 */
describe("whether two harness commits differ where a verdict comes from", () => {
  it("reads an identical pair as the same tool", () => {
    expect(
      harnessesDifferWhereItMatters(["abc1234", "abc1234"], () => {
        throw new Error("nothing to ask git: the commits are the same");
      }),
    ).toBe(false);
  });

  it("reads a pair differing only outside the closure as the same tool", () => {
    expect(
      harnessesDifferWhereItMatters(["abc1234", "def5678"], () => ["README.md", "docs/claims.md"]),
    ).toBe(false);
  });

  it("reads a pair differing inside the closure as different tools", () => {
    expect(
      harnessesDifferWhereItMatters(["abc1234", "def5678"], () => [
        "docs/claims.md",
        "src/gates/certification.ts",
      ]),
    ).toBe(true);
  });

  /**
   * A comparison nobody could make is not a comparison that passed. An unknown commit, a shallow
   * clone, anything git cannot answer about, has to read as different rather than as safe.
   */
  it("reads a pair git cannot answer about as different tools", () => {
    expect(
      harnessesDifferWhereItMatters(["abc1234", "def5678"], () => null),
    ).toBe(true);
  });

  it("reads one commit as nothing to compare", () => {
    expect(harnessesDifferWhereItMatters(["abc1234"], () => null)).toBe(false);
  });
});
