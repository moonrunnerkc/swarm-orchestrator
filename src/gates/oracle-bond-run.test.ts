import { describe, expect, it } from "vitest";
import type { LineHits } from "./mutant-witness.ts";
import { bondOracleWithMutants, type OracleBondRunner } from "./oracle-bond-run.ts";
import type { Mutant, MutantOperator } from "./oracle-mutants.ts";

const mutantOf = (
  line: number,
  operator: MutantOperator,
  before: string,
  after: string,
): Mutant => ({
  id: `lib/command.js:${line}:${operator}`,
  path: "lib/command.js",
  line,
  operator,
  before,
  after,
});

const negated = mutantOf(2, "negate-condition", "  if (ok) {", "  if (!(ok)) {");
const deleted = mutantOf(2, "delete-statement", "  if (ok) {", "");

interface Recorded {
  readonly oracleRuns: string[];
  readonly coverageReads: string[];
  readonly suiteRuns: string[];
}

/**
 * A runner over one in-memory file, which is what every case here needs: the loop's job is the
 * order it does things in and what it spends, and a real checkout measures neither.
 */
function fakeRunner(options: {
  readonly text?: string;
  readonly accepts?: (text: string) => boolean;
  readonly hits?: (text: string) => LineHits | null;
  readonly suite?: (text: string) => readonly { id: string; status: "passed" | "failed" }[];
  readonly parses?: (text: string) => boolean;
}): { runner: OracleBondRunner; recorded: Recorded; current: () => string } {
  let text = options.text ?? "const ok = true\n  if (ok) {\n  }\n";
  const recorded: Recorded = { oracleRuns: [], coverageReads: [], suiteRuns: [] };
  return {
    recorded,
    current: () => text,
    runner: {
      read: () => Promise.resolve(text),
      write: (_path, written) => {
        text = written;
        return Promise.resolve();
      },
      parses: () => Promise.resolve(options.parses?.(text) ?? true),
      runOracle: () => {
        recorded.oracleRuns.push(text);
        return Promise.resolve({ accepted: options.accepts?.(text) ?? true });
      },
      measureLineHits: () => {
        recorded.coverageReads.push(text);
        return Promise.resolve(options.hits?.(text) ?? null);
      },
      runRepositoryChecks: () => {
        recorded.suiteRuns.push(text);
        return Promise.resolve(options.suite?.(text) ?? [{ id: "tests", status: "passed" }]);
      },
    },
  };
}

const seenAtLineTwo: LineHits = { "lib/command.js": { 2: 4, 3: 4 } };

describe("running an oracle against each mutant of the change", () => {
  it("holds on a refusal without spending a detector on it", async () => {
    const { runner, recorded } = fakeRunner({ accepts: () => false });

    const bond = await bondOracleWithMutants({
      mutants: [negated],
      measured: seenAtLineTwo,
      checksWithPatch: [{ id: "tests", status: "passed" }],
      runner,
    });

    expect(bond.verdict).toBe("held");
    expect(bond.mutants[0]?.witness).toBe("not-adjudicated");
    expect(recorded.coverageReads).toEqual([]);
    expect(recorded.suiteRuns).toEqual([]);
  });

  it("reads coverage first, and stops there where coverage answers", async () => {
    const { runner, recorded } = fakeRunner({
      hits: (text) =>
        text.includes("!(ok)")
          ? { "lib/command.js": { 2: 4, 3: 0 } }
          : { "lib/command.js": { 2: 4, 3: 4 } },
    });

    const bond = await bondOracleWithMutants({
      mutants: [negated],
      measured: seenAtLineTwo,
      checksWithPatch: [{ id: "tests", status: "passed" }],
      runner,
    });

    expect(bond.verdict).toBe("vacuous");
    expect(bond.mutants[0]?.witness).toBe("coverage");
    expect(recorded.suiteRuns).toEqual([]);
  });

  it("asks the repository's own suite where coverage saw nothing", async () => {
    const { runner, recorded } = fakeRunner({
      hits: () => seenAtLineTwo,
      suite: (text) => [{ id: "tests", status: text.includes("!(ok)") ? "failed" : "passed" }],
    });

    const bond = await bondOracleWithMutants({
      mutants: [negated],
      measured: seenAtLineTwo,
      checksWithPatch: [{ id: "tests", status: "passed" }],
      runner,
    });

    expect(bond.verdict).toBe("vacuous");
    expect(bond.mutants[0]?.witness).toBe("repository-suite");
    expect(recorded.suiteRuns).toHaveLength(1);
  });

  /**
   * The loop's job is which detectors it spends and what it records, so that is what is asserted
   * here. Which verdict a recorded witness earns is `bondOfMutantObservations`, and asserting it
   * through the loop would be asserting the regime switch rather than the loop.
   */
  it("records that both detectors were asked and neither answered", async () => {
    const { runner, recorded } = fakeRunner({ hits: () => seenAtLineTwo });

    const bond = await bondOracleWithMutants({
      mutants: [negated],
      measured: seenAtLineTwo,
      checksWithPatch: [{ id: "tests", status: "passed" }],
      runner,
    });

    expect(bond.mutants[0]?.witness).toBe("none");
    expect(recorded.coverageReads).toHaveLength(1);
    expect(recorded.suiteRuns).toHaveLength(1);
  });

  /**
   * A mutant on a line nothing shows the oracle ran is `unshown` whatever a detector would say,
   * so no detector is spent on it.
   */
  it("spends nothing adjudicating a mutant the oracle is not shown to have run", async () => {
    const { runner, recorded } = fakeRunner({});

    const bond = await bondOracleWithMutants({
      mutants: [negated],
      measured: { "lib/command.js": { 2: 0 } },
      checksWithPatch: [{ id: "tests", status: "passed" }],
      runner,
    });

    expect(bond.verdict).toBe("unshown");
    expect(bond.mutants[0]?.witness).toBe("not-adjudicated");
    expect(recorded.coverageReads).toEqual([]);
    expect(recorded.suiteRuns).toEqual([]);
  });

  it("puts the file back after every mutant", async () => {
    const { runner, current } = fakeRunner({});
    const before = current();

    await bondOracleWithMutants({
      mutants: [negated],
      measured: seenAtLineTwo,
      checksWithPatch: [],
      runner,
    });

    expect(current()).toBe(before);
  });

  it("skips a mutant whose line the checkout does not hold", async () => {
    const { runner, recorded } = fakeRunner({ text: "const ok = true\n  if (nope) {\n  }\n" });

    const bond = await bondOracleWithMutants({
      mutants: [negated],
      measured: seenAtLineTwo,
      checksWithPatch: [],
      runner,
    });

    expect(bond.verdict).toBe("not-bonded");
    expect(recorded.oracleRuns).toEqual([]);
  });
});

describe("a deleted statement that has to be shown to parse", () => {
  /**
   * The reason the check exists. A file that no longer compiles is refused by every oracle there
   * is, and recording that as `held` credits the oracle with a refusal it never made.
   */
  it("records nothing for a deletion that does not parse", async () => {
    const { runner, recorded } = fakeRunner({
      parses: (text) => text.includes("if (ok)"),
      accepts: () => false,
    });

    const bond = await bondOracleWithMutants({
      mutants: [deleted],
      measured: seenAtLineTwo,
      checksWithPatch: [],
      runner,
    });

    expect(bond.verdict).toBe("not-bonded");
    expect(bond.mutants).toEqual([]);
    expect(recorded.oracleRuns).toEqual([]);
  });

  it("records nothing where the file it started from does not parse either", async () => {
    const { runner, recorded } = fakeRunner({ parses: () => false, accepts: () => false });

    const bond = await bondOracleWithMutants({
      mutants: [deleted],
      measured: seenAtLineTwo,
      checksWithPatch: [],
      runner,
    });

    expect(bond.verdict).toBe("not-bonded");
    expect(recorded.oracleRuns).toEqual([]);
  });

  it("uses a deletion that parses", async () => {
    const { runner } = fakeRunner({ parses: () => true, accepts: () => false });

    const bond = await bondOracleWithMutants({
      mutants: [deleted],
      measured: seenAtLineTwo,
      checksWithPatch: [],
      runner,
    });

    expect(bond.verdict).toBe("held");
  });

  it("asks for no parse check on an operator that cannot break the parse", async () => {
    const { runner } = fakeRunner({ parses: () => false, accepts: () => false });

    const bond = await bondOracleWithMutants({
      mutants: [negated],
      measured: seenAtLineTwo,
      checksWithPatch: [],
      runner,
    });

    expect(bond.verdict).toBe("held");
  });
});

describe("what adjudication is allowed to cost", () => {
  const three = [
    mutantOf(2, "negate-condition", "  if (ok) {", "  if (!(ok)) {"),
    mutantOf(3, "negate-condition", "  }", "  } "),
    mutantOf(4, "negate-condition", "", " "),
  ];

  it("bounds the suite runs one patch can spend and names what it did not ask", async () => {
    const { runner, recorded } = fakeRunner({
      text: "const ok = true\n  if (ok) {\n  }\n\n",
      hits: () => ({ "lib/command.js": { 2: 1, 3: 1, 4: 1 } }),
      suite: () => [{ id: "tests", status: "passed" }],
    });

    const bond = await bondOracleWithMutants({
      mutants: three,
      measured: { "lib/command.js": { 2: 1, 3: 1, 4: 1 } },
      checksWithPatch: [{ id: "tests", status: "passed" }],
      runner,
      suiteAdjudicationLimit: 1,
    });

    expect(recorded.suiteRuns).toHaveLength(1);
    expect(bond.mutants.map((one) => one.witness)).toEqual([
      "none",
      "not-adjudicated",
      "not-adjudicated",
    ]);
  });

  /**
   * One vacuous mutant decides the bond, so nothing is spent looking for a second one.
   */
  it("stops adjudicating once a gap is demonstrated", async () => {
    const { runner, recorded } = fakeRunner({
      text: "const ok = true\n  if (ok) {\n  }\n\n",
      hits: (text) =>
        text.includes("!(ok)")
          ? { "lib/command.js": { 2: 1, 3: 0, 4: 1 } }
          : { "lib/command.js": { 2: 1, 3: 1, 4: 1 } },
    });

    const bond = await bondOracleWithMutants({
      mutants: three,
      measured: { "lib/command.js": { 2: 1, 3: 1, 4: 1 } },
      checksWithPatch: [{ id: "tests", status: "passed" }],
      runner,
    });

    expect(bond.verdict).toBe("vacuous");
    expect(recorded.coverageReads).toHaveLength(1);
    expect(bond.mutants.map((one) => one.witness)).toEqual([
      "coverage",
      "not-adjudicated",
      "not-adjudicated",
    ]);
  });

  it("asks no suite where the patch left no passing check to compare against", async () => {
    const { runner, recorded } = fakeRunner({ hits: () => seenAtLineTwo });

    const bond = await bondOracleWithMutants({
      mutants: [negated],
      measured: seenAtLineTwo,
      checksWithPatch: [{ id: "tests", status: "failed" }],
      runner,
    });

    expect(recorded.suiteRuns).toEqual([]);
    expect(bond.mutants[0]?.witness).toBe("not-adjudicated");
  });
});
