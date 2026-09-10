import { describe, expect, it } from "vitest";
import { mutantsOfChangedLines } from "./oracle-mutants.ts";

const added = (lines: readonly [number, string][]) => lines.map(([line, text]) => ({ line, text }));

const only = (path: string, lines: readonly [number, string][]) => [
  { path, addedLines: added(lines) },
];

describe("mutants built from the lines a patch added", () => {
  it("inverts a comparison", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/command.js", [[10, "    if (value === other) {"]]),
    });

    expect(built).toHaveLength(1);
    expect(built[0]?.operator).toBe("invert-comparison");
    expect(built[0]?.after).toBe("    if (value !== other) {");
  });

  it("leaves an arrow alone, which is not a comparison", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/command.js", [[10, "    items.forEach((one) => one.run());"]]),
    });

    expect(built.map((one) => one.operator)).not.toContain("invert-comparison");
  });

  it("leaves a type argument alone, which is not a comparison", () => {
    const built = mutantsOfChangedLines({
      changed: only("src/index.ts", [[3, "  const seen = new Map<string, number>();"]]),
    });

    expect(built.map((one) => one.operator)).not.toContain("invert-comparison");
  });

  it("leaves a shift alone, which is not a comparison", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/bits.js", [[3, "  const mask = one << two;"]]),
    });

    expect(built.map((one) => one.operator)).not.toContain("invert-comparison");
  });

  /**
   * The mutant that finds commander#1671. Its patch merges parent options with the local value
   * winning, and the precedence is one `.reverse()` before the `Object.assign`. Dropping it
   * inverts the merge order, which is exactly the behaviour the held-back case names.
   */
  it("drops a no-argument call whose result the chain uses", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/command.js", [
        [1466, "      getCommandAndParents(this).reverse().forEach((cmd) => {"],
      ]),
    });

    const dropped = built.find((one) => one.operator === "drop-chained-call");
    expect(dropped?.after).toBe("      getCommandAndParents(this).forEach((cmd) => {");
  });

  it("leaves a no-argument call alone where nothing uses its result", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/command.js", [[10, "    this._outputConfiguration.clear();"]]),
    });

    expect(built.map((one) => one.operator)).not.toContain("drop-chained-call");
  });

  it("swaps the two arguments of a call", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/command.js", [[1468, "        Object.assign(result, cmd.opts());"]]),
    });

    const swapped = built.find((one) => one.operator === "swap-call-arguments");
    expect(swapped?.after).toBe("        Object.assign(cmd.opts(), result);");
  });

  it("leaves a declaration's parameters alone, which are not arguments", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/command.js", [[10, "  function merge(local, global) {"]]),
    });

    expect(built.map((one) => one.operator)).not.toContain("swap-call-arguments");
  });

  it("swaps the operands of a non-commutative arithmetic operator", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/duration.js", [[10, "  const span = end - start;"]]),
    });

    const swapped = built.find((one) => one.operator === "swap-arithmetic-operands");
    expect(swapped?.after).toBe("  const span = start - end;");
  });

  it("replaces a returned expression with a sentinel", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/command.js", [[1471, "    return result;"]]),
    });

    const sentinel = built.find((one) => one.operator === "return-sentinel");
    expect(sentinel?.after).toBe("    return undefined;");
  });

  it("leaves a return of undefined alone, which the sentinel would not change", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/command.js", [[10, "    return undefined;"]]),
    });

    expect(built).toEqual([]);
  });

  /**
   * Reach skips both of these for the same reason: an acceptance oracle runs its own test file
   * and never the candidate's, and a file no runner loads has no behaviour to mutate. A mutant
   * there could only be refused for a reason that is not about the patch.
   */
  it("builds nothing in the patch's own tests", () => {
    const built = mutantsOfChangedLines({
      changed: only("tests/options.test.js", [[10, "  expect(one === two).toBe(true);"]]),
    });

    expect(built).toEqual([]);
  });

  it("builds nothing in a file no runner could load", () => {
    const built = mutantsOfChangedLines({
      changed: [
        { path: "CHANGELOG.md", addedLines: added([[10, "- one === two is now checked"]]) },
        { path: "typings/index.d.ts", addedLines: added([[10, "  opts(): T === U;"]]) },
      ],
    });

    expect(built).toEqual([]);
  });

  it("ignores a comparison inside a string or a comment", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/command.js", [
        [10, '    const message = "value === other";'],
        [11, "    // value === other decides precedence"],
      ]),
    });

    expect(built).toEqual([]);
  });

  it("names every mutant once, by file, line and operator", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/command.js", [
        [10, "    if (value === other) {"],
        [11, "    return result;"],
      ]),
    });

    expect(built.map((one) => one.id)).toEqual([
      "lib/command.js:10:invert-comparison",
      "lib/command.js:11:return-sentinel",
    ]);
    expect(new Set(built.map((one) => one.id)).size).toBe(built.length);
  });

  /**
   * The cap is a cost bound and nothing else: each mutant is one more oracle run. Ordered by how
   * often an operator produces a mutant that changes nothing, so what a cap cuts is the mutants
   * most likely to have been equivalent anyway.
   */
  it("caps how many mutants one patch produces, lowest-risk operators first", () => {
    const comparisons = Array.from(
      { length: 20 },
      (_, index) => [index + 1, `    if (a${index} === b${index}) {`] as [number, string],
    );
    const built = mutantsOfChangedLines({
      changed: only("lib/command.js", [...comparisons, [90, "    return result;"]]),
      limit: 4,
      perOperatorLimit: 2,
    });

    expect(built).toHaveLength(3);
    expect(built.filter((one) => one.operator === "invert-comparison")).toHaveLength(2);
    expect(built.filter((one) => one.operator === "return-sentinel")).toHaveLength(1);
  });

  it("builds one mutant per line, so no two mutants of one line collide", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/command.js", [
        [10, "    return end - start === span ? one.slice().sort() : other;"],
      ]),
    });

    expect(built).toHaveLength(1);
  });
});

/**
 * dayjs#2367 divides a rounded call by a literal. An operand rule that only knows names leaves
 * that patch with nothing to bond, which is a gap in the check reported as a property of the
 * patch.
 */
describe("what counts as an operand", () => {
  it("swaps a call with a literal", () => {
    const built = mutantsOfChangedLines({
      changed: only("src/plugin/duration/index.js", [
        [142, "      seconds += Math.round(this.$d.milliseconds) / 1000"],
      ]),
    });

    expect(built[0]?.operator).toBe("swap-arithmetic-operands");
    expect(built[0]?.after).toBe("      seconds += 1000 / Math.round(this.$d.milliseconds)");
  });

  it("leaves a unary sign alone, where swapping means the same thing", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/math.js", [[3, "  const total = -1 - 2;"]]),
    });

    expect(built.map((one) => one.operator)).not.toContain("swap-arithmetic-operands");
  });
});
