import { describe, expect, it } from "vitest";
import { describeOracleBond } from "./cli-bond-report.ts";

const mutant = (
  verdict: string,
  witness: string,
  before = "  parents.reverse().forEach(run)",
  after = "  parents.forEach(run)",
) => ({ id: `lib/command.js:12:drop-chained-call`, verdict, witness, before, after });

describe("the bond line beside a verdict", () => {
  it("says nothing was asked where no mutant could be built", () => {
    const line = describeOracleBond({ oracleBond: "not-bonded", bondedMutants: [] });

    expect(line).toContain("no mutant of the change could be built");
  });

  it("counts the refusals a held bond earned", () => {
    const line = describeOracleBond({
      oracleBond: "held",
      bondedMutants: [mutant("held", "not-adjudicated"), mutant("held", "not-adjudicated")],
    });

    expect(line).toContain("2 mutant(s) of the change refused");
  });

  /**
   * A gap has to name the line and the change to it, because "the oracle is inadequate" is not
   * actionable without them, and now also what showed the mutant changed anything: a refusal
   * carrying a witness rests on an instrument, and one carrying none rests on the operator alone.
   */
  it("names the mutant a gap was found on and what witnessed it", () => {
    const line = describeOracleBond({
      oracleBond: "vacuous",
      bondedMutants: [mutant("vacuous", "coverage")],
    });

    expect(line).toContain("lib/command.js:12:drop-chained-call");
    expect(line).toContain("parents.reverse().forEach(run)");
    expect(line).toContain("coverage");
  });

  it("says a gap nothing witnessed rests on the operator alone", () => {
    const line = describeOracleBond({
      oracleBond: "vacuous",
      bondedMutants: [mutant("vacuous", "none")],
    });

    expect(line).toContain("no detector");
  });

  /**
   * The two absences a single `unshown` used to be printed for, which are different things a
   * reader would act on differently. One is about the oracle's coverage; the other is about what
   * an instrument could show of the mutant.
   */
  it("says the oracle is not shown to have run the mutated lines", () => {
    const line = describeOracleBond({
      oracleBond: "unshown",
      bondedMutants: [mutant("unshown", "not-adjudicated")],
    });

    expect(line).toContain("nothing shows it ran the mutated lines");
  });

  it("says the mutant ran and nothing showed it changed anything", () => {
    const line = describeOracleBond({
      oracleBond: "unshown",
      bondedMutants: [mutant("unshown", "none")],
    });

    expect(line).not.toContain("nothing shows it ran the mutated lines");
    expect(line).toContain("nothing showed the mutant changed");
  });
});
