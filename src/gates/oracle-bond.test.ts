import { describe, expect, it } from "vitest";
import { bondOfMutantObservations, mutantWasSeen } from "./oracle-bond.ts";

const mutant = (id: string) => ({
  id,
  path: "lib/command.js",
  line: 10,
  operator: "invert-comparison" as const,
  before: "  if (a === b) {",
  after: "  if (a !== b) {",
});

const observed = (id: string, oracle: "passed" | "failed", seen: boolean) => ({
  mutant: mutant(id),
  oracle,
  seen,
});

describe("what bonding an oracle with a mutant of the change showed", () => {
  it("holds where the oracle refused the mutant", () => {
    const bond = bondOfMutantObservations([observed("one", "failed", true)]);

    expect(bond.verdict).toBe("held");
    expect(bond.mutants[0]?.verdict).toBe("held");
  });

  it("is vacuous where the oracle accepted a mutant it demonstrably ran", () => {
    const bond = bondOfMutantObservations([observed("one", "passed", true)]);

    expect(bond.verdict).toBe("vacuous");
  });

  it("is unshown where the oracle accepted a mutant nothing says it ran", () => {
    const bond = bondOfMutantObservations([observed("one", "passed", false)]);

    expect(bond.verdict).toBe("unshown");
  });

  it("is not bonded where no mutant could be built", () => {
    const bond = bondOfMutantObservations([]);

    expect(bond.verdict).toBe("not-bonded");
    expect(bond.mutants).toEqual([]);
  });

  /**
   * One demonstrated gap is a gap. An oracle that refuses four mutants and accepts a fifth it ran
   * has been shown not to test that fifth line, and the four say nothing about it.
   */
  it("reports the gap where one mutant of several got past a seeing oracle", () => {
    const bond = bondOfMutantObservations([
      observed("one", "failed", true),
      observed("two", "passed", true),
    ]);

    expect(bond.verdict).toBe("vacuous");
  });

  it("prefers a refusal to an absence of evidence", () => {
    const bond = bondOfMutantObservations([
      observed("one", "passed", false),
      observed("two", "failed", false),
    ]);

    expect(bond.verdict).toBe("held");
  });
});

describe("whether the oracle demonstrably ran the line a mutant changed", () => {
  it("says yes where the coverage of that run names the line with a hit", () => {
    expect(mutantWasSeen({ "lib/command.js": { 10: 3 } }, mutant("one"))).toBe(true);
  });

  it("says no where the coverage names the line with no hits", () => {
    expect(mutantWasSeen({ "lib/command.js": { 10: 0 } }, mutant("one"))).toBe(false);
  });

  /**
   * Not measured is not seen. An oracle whose reach nobody could measure gets `unshown` rather
   * than `vacuous`, which is the same rule the gate bonds use: absence of evidence about the
   * check is not evidence against it.
   */
  it("says no where nothing was measured", () => {
    expect(mutantWasSeen(null, mutant("one"))).toBe(false);
    expect(mutantWasSeen({}, mutant("one"))).toBe(false);
  });
});
