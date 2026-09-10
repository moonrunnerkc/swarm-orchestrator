import { describe, expect, it } from "vitest";
import { lineHitsByWorkspacePath, oracleReachedTheChange } from "./oracle-reach.ts";

/**
 * Lines with a body on them, for the cases that only care about the numbers. Reach reads what is
 * on a line now, because a line holding one closing brace runs no code of its own, so a case that
 * names a line has to say what is on it.
 */
const numbered = (lines: readonly number[]) =>
  lines.map((line) => ({ line, text: `  value${line} = compute(${line});` }));

/**
 * The measurement that motivated this. koa#1946 was certified by an oracle that never executed the
 * branch the held-back oracle refuses: `swarm ci` said verified, and running the sealed half under
 * coverage showed lines 270-273 of the file it changed were never reached.
 *
 * An oracle that did not run a line cannot have judged it, and certifying on one that skipped part
 * of the change is the tool asserting more than it measured.
 */
describe("whether the oracle ran the lines the patch changed", () => {
  const changed = [{ path: "lib/application.js", addedLines: numbered([85, 265, 270, 271]) }];

  /** Hits by line as the report gave them: a line absent from it was never executable. */
  const measured = (hits: Record<number, number>) => ({ "lib/application.js": hits });

  it("says no when added lines were never executed", () => {
    const reach = oracleReachedTheChange({
      changed,
      measured: measured({ 85: 3, 265: 1, 270: 0, 271: 0 }),
    });

    expect(reach.reached).toBe(false);
    expect(reach.unreached).toEqual([{ path: "lib/application.js", lines: [270, 271] }]);
  });

  it("says yes when every added line ran", () => {
    const reach = oracleReachedTheChange({
      changed,
      measured: measured({ 85: 3, 265: 1, 270: 1, 271: 2, 999: 1 }),
    });

    expect(reach.reached).toBe(true);
    expect(reach.unreached).toEqual([]);
  });

  // No report is not a report of full coverage. An oracle whose reach could not be measured is
  // not shown to have judged anything, and saying otherwise is the collapse of unmeasured into
  // pass that the rest of this project refuses.
  it("does not claim reach for a file the report never mentions", () => {
    const reach = oracleReachedTheChange({ changed, measured: {} });

    expect(reach.reached).toBe(false);
    expect(reach.unreached).toEqual([{ path: "lib/application.js", lines: [85, 265, 270, 271] }]);
  });

  it("ignores a file the patch did not add lines to", () => {
    const reach = oracleReachedTheChange({
      changed: [{ path: "README.md", addedLines: [] }],
      measured: {},
    });

    expect(reach.reached).toBe(true);
  });

  /**
   * A report names the lines it could have executed. A blank line, a comment, a closing brace and
   * a bare `else` are none of them, so they carry no entry, and counting an absent entry as a line
   * the oracle skipped marks every patch unreached: a change that adds one comment beside a line
   * the oracle ran would refuse certification for a line nothing can execute.
   */
  it("does not count an added line the report never called executable", () => {
    const reach = oracleReachedTheChange({
      changed: [{ path: "lib/application.js", addedLines: numbered([85, 86, 87]) }],
      // 86 and 87 are the comment and the closing brace the patch added beside line 85.
      measured: measured({ 85: 4 }),
    });

    expect(reach.reached).toBe(true);
  });

  it("still counts an executable added line the report says never ran", () => {
    const reach = oracleReachedTheChange({
      changed: [{ path: "lib/application.js", addedLines: numbered([85, 86, 87]) }],
      measured: measured({ 85: 4, 86: 0 }),
    });

    expect(reach.reached).toBe(false);
    expect(reach.unreached).toEqual([{ path: "lib/application.js", lines: [86] }]);
  });
});

/**
 * Measured, not assumed. Running the sealed oracle of three koa tasks under coverage and reading
 * what it left unexecuted:
 *
 *   koa#1946  lib/application.js            27 added,  4 never ran   <- the real finding
 *   koa#1999  lib/request.js                 5 added,  0 never ran
 *             __tests__/request/whatwg-url    57 added, absent from the report
 *   koa#1904  lib/response.js                2 added,  0 never ran
 *             __tests__/response/attachment   36 added, absent from the report
 *
 * Counting those test files against reach turned two patches both oracles accept into refusals.
 * It also asserts something false: an acceptance oracle runs its own test file and never the
 * candidate's, so the candidate's tests are absent from every report by construction, and
 * "the oracle did not execute your tests" is not a finding about the patch.
 */
describe("the patch's own tests", () => {
  it("does not count a test file the oracle was never going to run", () => {
    const reach = oracleReachedTheChange({
      changed: [
        { path: "lib/request.js", addedLines: numbered([40, 41]) },
        { path: "__tests__/request/whatwg-url.test.js", addedLines: numbered([1, 2, 3]) },
      ],
      measured: { "lib/request.js": { 40: 2, 41: 1 } },
    });

    expect(reach.reached).toBe(true);
  });

  /** The catch this exists for survives the change: source lines still have to run. */
  it("still refuses a source file whose added lines never ran", () => {
    const reach = oracleReachedTheChange({
      changed: [
        { path: "lib/application.js", addedLines: numbered([265, 270]) },
        { path: "__tests__/application/currentContext.test.js", addedLines: numbered([1, 2]) },
      ],
      measured: { "lib/application.js": { 265: 3, 270: 0 } },
    });

    expect(reach.reached).toBe(false);
    expect(reach.unreached).toEqual([{ path: "lib/application.js", lines: [270] }]);
  });

  /** And a source file the oracle never loaded at all is still the stronger version of that. */
  it("still refuses a source file the report never mentions", () => {
    const reach = oracleReachedTheChange({
      changed: [{ path: "lib/response.js", addedLines: numbered([12]) }],
      measured: { "lib/request.js": { 40: 1 } },
    });

    expect(reach.reached).toBe(false);
  });

  it("reads the conventional test paths and leaves names that merely contain the word", () => {
    const onlyTests = (path: string) =>
      oracleReachedTheChange({ changed: [{ path, addedLines: numbered([1]) }], measured: {} })
        .reached;

    for (const path of [
      "__tests__/a.js",
      "test/a.js",
      "tests/unit/a.js",
      "spec/a.js",
      "src/a.test.ts",
      "src/a.spec.js",
      "src/__tests__/a.tsx",
    ]) {
      expect({ path, ignored: onlyTests(path) }).toEqual({ path, ignored: true });
    }

    for (const path of [
      "src/latest.ts",
      "src/contest.js",
      "src/testing-helpers.ts",
      "lib/spec.ts",
    ]) {
      expect({ path, ignored: onlyTests(path) }).toEqual({ path, ignored: false });
    }
  });
});

describe("a file no runner can execute", () => {
  /**
   * Measured: commander#1711 was refused because its oracle never ran lines 11, 13 and 15 of
   * `CHANGELOG.md`. Nothing runs a changelog. A file a runner cannot load has no executable line,
   * so it can never be reached and refuses every patch that touches it.
   *
   * The same shape as the test-file convention beside it, and wrong in the same two directions: a
   * source file this does not recognize drops out of reach, which weakens the check by one file; a
   * file that genuinely cannot be covered but is recognized refuses a patch that is fine. Only one
   * of those is silent, and it is not this one, because the unreached files are named.
   */
  it("cannot be the reason an oracle is refused", () => {
    const reach = oracleReachedTheChange({
      changed: [
        { path: "CHANGELOG.md", addedLines: numbered([11, 13, 15]) },
        { path: "package.json", addedLines: numbered([4]) },
        { path: "docs/api.md", addedLines: numbered([2]) },
      ],
      measured: {},
    });

    expect(reach.reached).toBe(true);
  });

  it("still judges every spelling of a script the runners load", () => {
    for (const path of [
      "lib/a.js",
      "lib/a.mjs",
      "lib/a.cjs",
      "src/a.ts",
      "src/a.tsx",
      "src/a.mts",
    ]) {
      const reach = oracleReachedTheChange({
        changed: [{ path, addedLines: numbered([7]) }],
        measured: {},
      });

      expect(`${path} judged: ${!reach.reached}`).toBe(`${path} judged: true`);
    }
  });
});

describe("a line with nothing on it but punctuation", () => {
  /**
   * Measured on the hand-authored corpus: all four patches the reach check refused there were
   * refused on a line holding one closing brace. A coverage report names such a line, because a
   * function whose paths all return early never reaches the implicit end of it, and lcov reports
   * that as a line with zero hits. It is still not behaviour: nothing an oracle could exercise
   * lives on it, so "the oracle did not judge this line" says nothing about the patch.
   *
   * The rule is syntactic rather than a guess: a line carrying no character that could begin an
   * identifier, a number or a string runs no code of its own. `} else {` keeps its `else` and is
   * judged; `}` and `});` are not.
   */
  it("cannot be the reason an oracle is refused", () => {
    const reach = oracleReachedTheChange({
      changed: [
        {
          path: "src/List.ts",
          addedLines: [
            { line: 115, text: "      return Tuple(res[0], res[1])" },
            { line: 116, text: "  }" },
            { line: 117, text: "}" },
          ],
        },
      ],
      measured: { "src/List.ts": { 115: 3, 116: 0, 117: 0 } },
    });

    expect(reach.reached).toBe(true);
  });

  it("is still refused where behaviour on the line went unrun", () => {
    const reach = oracleReachedTheChange({
      changed: [
        {
          path: "src/List.ts",
          addedLines: [
            { line: 115, text: "      return Tuple(res[0], res[1])" },
            { line: 117, text: "}" },
          ],
        },
      ],
      measured: { "src/List.ts": { 115: 0, 117: 0 } },
    });

    expect(reach.unreached).toEqual([{ path: "src/List.ts", lines: [115] }]);
  });

  // `} else {` is a branch, not a brace: the keyword on it is code and an oracle that never took
  // that branch did not judge it.
  it("keeps a line whose punctuation surrounds a keyword", () => {
    const reach = oracleReachedTheChange({
      changed: [{ path: "a.js", addedLines: [{ line: 4, text: "  } else {" }] }],
      measured: { "a.js": { 4: 0 } },
    });

    expect(reach.reached).toBe(false);
  });
});

describe("lineHitsByWorkspacePath", () => {
  // node's lcov reporter writes `SF:` relative to the directory it ran in; jest and vitest write
  // it absolute. The patch names paths one way only, so the report is brought to the patch's
  // spelling rather than the comparison being loosened to accept both.
  it("keeps a relative section name as the patch would write it", () => {
    const measured = lineHitsByWorkspacePath(
      [{ file: "lib/application.js", hits: new Map([[270, 0]]) }],
      "/checkout",
    );

    expect(measured["lib/application.js"]?.[270]).toBe(0);
  });

  it("makes an absolute section name relative to the checkout", () => {
    const measured = lineHitsByWorkspacePath(
      [{ file: "/checkout/src/index.js", hits: new Map([[12, 3]]) }],
      "/checkout",
    );

    expect(measured["src/index.js"]?.[12]).toBe(3);
  });

  // A section for something outside the tree is not a file the patch can have changed, and
  // keeping it under a name that climbs out of the checkout would match nothing anyway.
  it("drops a section naming a file outside the checkout", () => {
    const measured = lineHitsByWorkspacePath(
      [{ file: "/elsewhere/other.js", hits: new Map([[1, 1]]) }],
      "/checkout",
    );

    expect(Object.keys(measured)).toEqual([]);
  });
});
