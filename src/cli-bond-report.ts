/** What one mutant of the change showed, as the verdict record carries it. */
interface ReportedMutant {
  readonly id: string;
  readonly verdict: string;
  /** Which detector answered. Absent on a row recorded before there was one. */
  readonly witness?: string | undefined;
  readonly before: string;
  readonly after: string;
}

/**
 * What the mutants of the change showed about the oracle, beside the reach verdict.
 *
 * A gap names the mutant that found it, because "the oracle is inadequate" is not actionable
 * without the line and the change to it, and it names what witnessed the change, because a
 * refusal resting on an instrument and one resting on the operator alone are different amounts of
 * evidence. A bond that held names how many mutants it refused, since one refusal and five are
 * not the same claim.
 *
 * `unshown` is two different absences and used to be printed as one. An oracle nothing shows ran
 * the mutated line is a fact about its coverage; a mutant it did run that nothing showed changed
 * anything is a fact about what an instrument can see. A reader acts on those differently, and
 * printing the first sentence for the second case sent them to look at coverage that was fine.
 */
export function describeOracleBond(result: {
  readonly oracleBond: string;
  readonly bondedMutants: readonly ReportedMutant[];
}): string {
  if (result.oracleBond === "not-bonded") {
    return " (no mutant of the change could be built, so nothing was asked of the oracle)";
  }

  const gap = result.bondedMutants.find((one) => one.verdict === "vacuous");
  if (gap !== undefined) {
    const shown =
      gap.witness === "coverage" || gap.witness === "repository-suite"
        ? `, ${gap.witness} showed it changed what the program did`
        : ", and no detector showed the mutant changed anything";
    return `\n  accepted ${gap.id}${shown}\n    - ${gap.before.trim()}\n    + ${gap.after.trim()}`;
  }

  const held = result.bondedMutants.filter((one) => one.verdict === "held").length;
  if (held > 0) {
    return ` (${held} mutant(s) of the change refused)`;
  }
  // Only where the oracle accepted a mutant it demonstrably ran can a detector have been asked, so
  // a recorded witness is what separates the two absences.
  const adjudicated = result.bondedMutants.some(
    (one) => one.witness !== undefined && one.witness !== "not-adjudicated",
  );
  return adjudicated
    ? " (the oracle accepted a mutant it ran, and nothing showed the mutant changed anything)"
    : " (the oracle accepted, and nothing shows it ran the mutated lines)";
}
