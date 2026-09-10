import { describe, expect, it } from "vitest";
import {
  coverageWitnessesADifference,
  suiteWitnessesADifference,
  witnessOfADifference,
} from "./mutant-witness.ts";

const mutated = { path: "lib/command.js", line: 20 };

describe("what coverage can witness about a mutant", () => {
  /**
   * A negated condition runs the other branch, so a line that ran in one reading and not in the
   * other is a demonstrated difference in what the program did. This is the witness that replaces
   * a person reading the mutated line and calling it behaviour-changing.
   */
  it("witnesses a line that ran before and not after", () => {
    expect(
      coverageWitnessesADifference({
        before: { "lib/command.js": { 20: 1, 21: 3, 30: 0 } },
        after: { "lib/command.js": { 20: 1, 21: 0, 30: 0 } },
        mutated,
      }),
    ).toBe(true);
  });

  it("witnesses a line that ran after and not before", () => {
    expect(
      coverageWitnessesADifference({
        before: { "lib/command.js": { 20: 1, 30: 0 } },
        after: { "lib/command.js": { 20: 1, 30: 4 } },
        mutated,
      }),
    ).toBe(true);
  });

  /**
   * The reason the mutated line is excluded: a deleted statement stops running by construction,
   * and reading that as a behaviour change would witness every deletion.
   */
  it("does not witness the mutated line stopping", () => {
    expect(
      coverageWitnessesADifference({
        before: { "lib/command.js": { 20: 2, 21: 2 } },
        after: { "lib/command.js": { 20: 0, 21: 2 } },
        mutated,
      }),
    ).toBe(false);
  });

  /**
   * The swapped `Math.min` and the falsy `return-sentinel` the hand audit found are both this
   * shape: every line runs the same number of times and the value differs. Coverage says nothing,
   * which is the answer, and the second detector is asked next.
   */
  it("does not witness a mutant that changed no line's execution", () => {
    expect(
      coverageWitnessesADifference({
        before: { "lib/command.js": { 20: 1, 21: 1 } },
        after: { "lib/command.js": { 20: 1, 21: 1 } },
        mutated,
      }),
    ).toBe(false);
  });

  /**
   * A count that moves is the weaker signal and the flakier one, and the direction this can be
   * wrong in is a refusal, which is the direction that must not be wrong.
   */
  it("does not witness a hit count that only moved", () => {
    expect(
      coverageWitnessesADifference({
        before: { "lib/command.js": { 20: 1, 21: 4 } },
        after: { "lib/command.js": { 20: 1, 21: 9 } },
        mutated,
      }),
    ).toBe(false);
  });

  /**
   * A line one reading names and the other does not is a difference in what the instrumentation
   * saw rather than in what the program did, and reading it as the second thing would refuse on
   * an artifact.
   */
  it("compares only lines both readings name", () => {
    expect(
      coverageWitnessesADifference({
        before: { "lib/command.js": { 20: 1, 21: 1 } },
        after: { "lib/command.js": { 20: 1, 21: 1, 99: 7 } },
        mutated,
      }),
    ).toBe(false);
  });

  it("witnesses a difference in a file other than the mutated one", () => {
    expect(
      coverageWitnessesADifference({
        before: { "lib/command.js": { 20: 1 }, "lib/option.js": { 5: 2 } },
        after: { "lib/command.js": { 20: 1 }, "lib/option.js": { 5: 0 } },
        mutated,
      }),
    ).toBe(true);
  });

  it("witnesses nothing where either reading is missing", () => {
    const before = { "lib/command.js": { 20: 1, 21: 1 } };
    expect(coverageWitnessesADifference({ before, after: null, mutated })).toBe(false);
    expect(coverageWitnessesADifference({ before: null, after: before, mutated })).toBe(false);
  });
});

describe("what the repository's own suite can witness about a mutant", () => {
  it("witnesses a check that passed with the patch and fails on the mutant", () => {
    expect(
      suiteWitnessesADifference({
        withPatch: [{ id: "tests", status: "passed" }],
        withMutant: [{ id: "tests", status: "failed" }],
      }),
    ).toBe(true);
  });

  /**
   * A check that was already failing witnesses nothing: it fails either way, and charging its
   * failure to the mutant is the same error as charging an inherited failure to a patch.
   */
  it("reads no check that was already failing with the patch applied", () => {
    expect(
      suiteWitnessesADifference({
        withPatch: [{ id: "tests", status: "failed" }],
        withMutant: [{ id: "tests", status: "failed" }],
      }),
    ).toBe(false);
  });

  it("reads no check that stood down", () => {
    expect(
      suiteWitnessesADifference({
        withPatch: [{ id: "tests", status: "not-applicable" }],
        withMutant: [{ id: "tests", status: "failed" }],
      }),
    ).toBe(false);
  });

  it("witnesses nothing where the same checks pass either way", () => {
    expect(
      suiteWitnessesADifference({
        withPatch: [
          { id: "lint", status: "passed" },
          { id: "tests", status: "passed" },
        ],
        withMutant: [
          { id: "lint", status: "passed" },
          { id: "tests", status: "passed" },
        ],
      }),
    ).toBe(false);
  });

  it("witnesses nothing about a check the second run did not report", () => {
    expect(
      suiteWitnessesADifference({
        withPatch: [{ id: "tests", status: "passed" }],
        withMutant: [],
      }),
    ).toBe(false);
  });
});

describe("which detector decided it", () => {
  it("names coverage where coverage saw the difference", () => {
    expect(witnessOfADifference({ coverage: true, suite: false })).toBe("coverage");
  });

  it("names the suite where only the suite saw it", () => {
    expect(witnessOfADifference({ coverage: false, suite: true })).toBe("repository-suite");
  });

  it("says neither saw anything", () => {
    expect(witnessOfADifference({ coverage: false, suite: false })).toBe("none");
  });

  /**
   * Not the same as neither detector seeing anything. A suite run that was never spent is an
   * absence of evidence, and flattening it into either answer is what this whole check is against.
   */
  it("says the suite was never asked", () => {
    expect(witnessOfADifference({ coverage: false, suite: null })).toBe("not-adjudicated");
  });

  it("prefers the detector that answered over the one that was never asked", () => {
    expect(witnessOfADifference({ coverage: true, suite: null })).toBe("coverage");
  });
});
