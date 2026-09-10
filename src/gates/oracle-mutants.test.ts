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

  it("changes a return of undefined into something a caller can tell apart", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/command.js", [[10, "    return undefined;"]]),
    });

    expect(built[0]?.after).toBe('    return "swarm-oracle-bond";');
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

    // The string line is still a statement, and `replace-assigned-value` reads it as one. What
    // must not happen is a comparison being found inside the message or the prose.
    expect(built.map((one) => one.operator)).not.toContain("invert-comparison");
    expect(built.map((one) => one.line)).toEqual([10]);
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

/**
 * Found by auditing a `vacuous` verdict rather than by reasoning: commander#1711 adds
 * `return false;` inside a `filter` predicate, and replacing it with `return undefined;` is the
 * same predicate, because `filter` reads truthiness and both are falsy. A sentinel equivalent to
 * what it replaces is not a sentinel, and the oracle's acceptance of it says nothing about the
 * oracle.
 */
describe("a sentinel that has to differ from what it replaces", () => {
  it("uses a truthy sentinel where the returned expression is a falsy literal", () => {
    for (const falsy of ["false", "0", "null", "undefined", "''", "NaN"]) {
      const built = mutantsOfChangedLines({
        changed: only("lib/command.js", [[10, `              return ${falsy};`]]),
      });

      expect(built[0]?.operator).toBe("return-sentinel");
      expect(built[0]?.after).toBe('              return "swarm-oracle-bond";');
    }
  });

  it("keeps undefined where the returned expression is anything else", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/command.js", [[10, "    return results;"]]),
    });

    expect(built[0]?.after).toBe("    return undefined;");
  });

  /**
   * The residual this leaves, named: the truthiness of an expression that is not a literal is not
   * syntactically known, so `undefined` is equivalent wherever that expression was falsy at
   * runtime and the caller read only its truthiness.
   */
  it("leaves a returned expression whose truthiness nothing here can know", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/command.js", [[10, "    return cache.get(key);"]]),
    });

    expect(built[0]?.after).toBe("    return undefined;");
  });
});

/**
 * The second artifact the audit found, and it is in the operator's own name: swapping the
 * arguments of a *commutative* call changes nothing. `Math.min(i + size, len)` became
 * `Math.min(len, i + size)` on a darkreader patch, the oracle accepted it, and that was recorded
 * as a gap in an oracle that had none.
 */
describe("a call whose arguments have an order", () => {
  it("leaves a commutative standard-library call alone", () => {
    for (const call of [
      "    const end = Math.min(i + size, len);",
      "    const start = Math.max(first, second);",
      "    const span = Math.hypot(width, height);",
      "    if (Object.is(one, other)) {",
    ]) {
      const built = mutantsOfChangedLines({ changed: only("src/utils/array.ts", [[10, call]]) });

      expect(built.map((one) => one.operator)).not.toContain("swap-call-arguments");
    }
  });

  it("still swaps a call whose arguments mean different things", () => {
    const built = mutantsOfChangedLines({
      changed: only("src/utils/array.ts", [
        [10, "        results.push(Array.from(items.slice(i, i + size)));"],
      ]),
    });

    expect(built[0]?.operator).toBe("swap-call-arguments");
    expect(built[0]?.after).toBe("        results.push(Array.from(items.slice(i + size, i)));");
  });
});

/**
 * The shapes the first five operators had no rule for. Read off the language's statement
 * productions rather than off the patches that exposed the gap: an operator chosen knowing the
 * case it has to catch measures the choosing. The design and the ordering are in
 * `docs/oracle-bond-operators.md`.
 */
describe("the conditions a guard clause decides", () => {
  it("negates an if condition that carries no comparison", () => {
    const built = mutantsOfChangedLines({
      changed: only("src/plugin/timezone/index.js", [[96, "    if (!this.isValid()) {"]]),
    });

    expect(built[0]?.operator).toBe("negate-condition");
    expect(built[0]?.after).toBe("    if (!(!this.isValid())) {");
  });

  it("negates an else-if condition, which is the same rule", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/application.js", [[87, "      } else if (options.zone) {"]]),
    });

    expect(built[0]?.after).toBe("      } else if (!(options.zone)) {");
  });

  it("negates a while condition", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/queue.js", [[10, "    while (pending.length) {"]]),
    });

    expect(built[0]?.operator).toBe("negate-condition");
    expect(built[0]?.after).toBe("    while (!(pending.length)) {");
  });

  it("leaves a comparison to the operator that reads comparisons", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/command.js", [[10, "    if (value === other) {"]]),
    });

    expect(built[0]?.operator).toBe("invert-comparison");
  });

  /**
   * `if` and `while` are read as keywords, not as three or five characters. A call whose name
   * ends in either would otherwise have its arguments wrapped in a negation, which changes what
   * the call is handed rather than which branch runs.
   */
  it("leaves a call whose name ends in the keyword alone", () => {
    for (const line of ["    const found = motif(list);", "    const seen = erstwhile(all);"]) {
      const built = mutantsOfChangedLines({ changed: only("lib/text.js", [[10, line]]) });

      expect(built.map((one) => one.operator)).not.toContain("negate-condition");
    }
  });

  it("leaves a for head alone, whose condition is not the whole parenthesis", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/queue.js", [[10, "    for (const one of pending) {"]]),
    });

    expect(built.map((one) => one.operator)).not.toContain("negate-condition");
  });
});

describe("the value an assignment writes", () => {
  it("replaces the value a plain assignment writes", () => {
    const built = mutantsOfChangedLines({
      changed: only("src/plugin/timezone/index.js", [[97, "      this.$x.$timezone = timezone"]]),
    });

    expect(built[0]?.operator).toBe("replace-assigned-value");
    expect(built[0]?.after).toBe("      this.$x.$timezone = undefined");
  });

  it("replaces the value a declaration initialises with", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/application.js", [[12, "const parser = require('node:path')"]]),
    });

    expect(built[0]?.operator).toBe("replace-assigned-value");
    expect(built[0]?.after).toBe("const parser = undefined");
  });

  /**
   * The same rule `return-sentinel` was narrowed by, for the same reason: a sentinel that agrees
   * with what it replaces on truthiness is not a sentinel, and an oracle accepting it says
   * nothing about the oracle.
   */
  it("uses a truthy sentinel where the assigned value is a falsy literal", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/application.js", [[88, "        this.ctxStorage = null"]]),
    });

    expect(built[0]?.after).toBe('        this.ctxStorage = "swarm-oracle-bond"');
  });

  it("leaves a compound assignment alone, which is not a plain one", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/duration.js", [[10, "      collected += one"]]),
    });

    expect(built.map((one) => one.operator)).not.toContain("replace-assigned-value");
  });

  it("leaves a comparison alone, which is not an assignment", () => {
    for (const line of ["    const same = one == other;", "    const upTo = one <= other;"]) {
      const built = mutantsOfChangedLines({ changed: only("lib/compare.js", [[10, line]]) });

      expect(built.map((one) => one.operator)).not.toContain("replace-assigned-value");
    }
  });

  /** An arrow is not an assignment. The plain `=` in front of it is the one this reads. */
  it("reads the assignment in front of an arrow rather than the arrow", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/compare.js", [[10, "    const run = () => start();"]]),
    });

    expect(built[0]?.operator).toBe("replace-assigned-value");
    expect(built[0]?.after).toBe("    const run = undefined;");
  });
});

describe("a statement removed altogether", () => {
  it("blanks a complete statement", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/application.js", [[10, "      this.emit('ready')"]]),
    });

    expect(built[0]?.operator).toBe("delete-statement");
    expect(built[0]?.after).toBe("");
  });

  it("blanks a return the sentinel rule cannot read, which has no semicolon", () => {
    const built = mutantsOfChangedLines({
      changed: only("src/plugin/timezone/index.js", [[98, "      return this"]]),
    });

    expect(built[0]?.operator).toBe("delete-statement");
    expect(built[0]?.after).toBe("");
  });

  it("blanks rather than removes, so every line after it keeps its number", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/application.js", [[10, "      queue.flush()"]]),
    });

    expect(built[0]?.after).toBe("");
    expect(built[0]?.line).toBe(10);
  });

  it("leaves a line that opens a block", () => {
    for (const line of [
      "  function merge(local, global) {",
      "  try {",
      "    } else {",
      "      } catch (cause) {",
      "  switch (kind) {",
    ]) {
      const built = mutantsOfChangedLines({ changed: only("lib/command.js", [[10, line]]) });

      expect(built.map((one) => one.operator)).not.toContain("delete-statement");
    }
  });

  it("leaves a line that continues the one before it", () => {
    for (const line of [
      "      .then((one) => one.run())",
      "      ?.filter(Boolean)",
      "      , second",
      "      && other",
      "    ) {",
    ]) {
      const built = mutantsOfChangedLines({ changed: only("lib/command.js", [[10, line]]) });

      expect(built.map((one) => one.operator)).not.toContain("delete-statement");
    }
  });

  it("leaves a line the one after it continues", () => {
    for (const line of ["      const total = one +", "      collect(", "      const run = () =>"]) {
      const built = mutantsOfChangedLines({ changed: only("lib/command.js", [[10, line]]) });

      expect(built.map((one) => one.operator)).not.toContain("delete-statement");
    }
  });

  it("leaves a line whose brackets do not balance", () => {
    for (const line of ["      collect(one, two", "      })", "      ])"]) {
      const built = mutantsOfChangedLines({ changed: only("lib/command.js", [[10, line]]) });

      expect(built.map((one) => one.operator)).not.toContain("delete-statement");
    }
  });

  it("leaves a case label, which needs the block it heads", () => {
    for (const line of ["      case 'utc':", "      default:"]) {
      const built = mutantsOfChangedLines({ changed: only("lib/command.js", [[10, line]]) });

      expect(built.map((one) => one.operator)).not.toContain("delete-statement");
    }
  });

  it("leaves a line carrying no code at all", () => {
    for (const line of ["", "      ", "      }", "      });", "      ],"]) {
      const built = mutantsOfChangedLines({ changed: only("lib/command.js", [[10, line]]) });

      expect(built).toEqual([]);
    }
  });

  /**
   * Last in the ordering, because it is the operator that produces the most mutants which change
   * nothing observable, so a cost bound cuts it before it cuts anything else.
   */
  it("is the operator of last resort", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/command.js", [
        [10, "      queue.flush()"],
        [11, "      if (pending.length) {"],
      ]),
      limit: 1,
    });

    expect(built.map((one) => one.operator)).toEqual(["negate-condition"]);
  });
});

/**
 * A regular-expression literal is a literal, and it was not masked.
 *
 * Found by measuring a claim rather than by reasoning: `deletion-parse-rate.mjs` asserts that only
 * `delete-statement` can leave a file which does not parse, and over three real repositories
 * `swap-call-arguments` broke one of its 105 mutants. The line splits on a pattern whose own comma
 * is part of it, so the argument scan read that comma as the separator between two arguments and
 * swapped halves of a regex.
 *
 * The same blindness reaches every operator that scans for a token: a comparison inside a pattern
 * is not a comparison, and a slash or a percent inside one is not arithmetic.
 */
describe("a regular expression is a literal too", () => {
  it("does not read a comma inside a pattern as an argument separator", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/request.js", [[10, "    value.split(/\\s*,\\s*/);"]]),
    });

    expect(built.map((one) => one.operator)).not.toContain("swap-call-arguments");
  });

  it("does not read a comparison inside a pattern as a comparison", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/parse.js", [[10, "    if (/a > b/.test(one)) {"]]),
    });

    expect(built.map((one) => one.operator)).not.toContain("invert-comparison");
  });

  it("does not read arithmetic inside a pattern as arithmetic", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/parse.js", [[10, "    one.match(/a % b/);"]]),
    });

    expect(built.map((one) => one.operator)).not.toContain("swap-arithmetic-operands");
  });

  /**
   * Division still has to be readable, which is the whole difficulty: one character both starts a
   * pattern and divides. What comes before it decides, and after a name or a closing bracket it
   * divides.
   */
  it("still reads division as division", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/duration.js", [[10, "  const share = total / count;"]]),
    });

    expect(built[0]?.operator).toBe("swap-arithmetic-operands");
    expect(built[0]?.after).toBe("  const share = count / total;");
  });

  it("still swaps the arguments a call outside a pattern was given", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/request.js", [[10, "    merge(target, /a,b/.source);"]]),
    });

    expect(built[0]?.operator).toBe("swap-call-arguments");
    expect(built[0]?.after).toBe("    merge(/a,b/.source, target);");
  });

  it("reads a pattern that opens a line, where nothing before it decides", () => {
    const built = mutantsOfChangedLines({
      changed: only("lib/request.js", [[10, "      .replace(/a,b/g, ';')"]]),
    });

    expect(built.map((one) => one.operator)).not.toContain("swap-call-arguments");
  });
});
