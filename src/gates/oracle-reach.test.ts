import { describe, expect, it } from "vitest";
import { oracleReachedTheChange } from "./oracle-reach.ts";

/**
 * The measurement that motivated this. koa#1946 was certified by an oracle that never executed the
 * branch the held-back oracle refuses: `swarm ci` said verified, and running the sealed half under
 * coverage showed lines 270-273 of the file it changed were never reached.
 *
 * An oracle that did not run a line cannot have judged it, and certifying on one that skipped part
 * of the change is the tool asserting more than it measured.
 */
describe("whether the oracle ran the lines the patch changed", () => {
  const changed = [{ path: "lib/application.js", addedLines: [85, 265, 270, 271] }];

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
      changed: [{ path: "lib/application.js", addedLines: [85, 86, 87] }],
      // 86 and 87 are the comment and the closing brace the patch added beside line 85.
      measured: measured({ 85: 4 }),
    });

    expect(reach.reached).toBe(true);
  });

  it("still counts an executable added line the report says never ran", () => {
    const reach = oracleReachedTheChange({
      changed: [{ path: "lib/application.js", addedLines: [85, 86, 87] }],
      measured: measured({ 85: 4, 86: 0 }),
    });

    expect(reach.reached).toBe(false);
    expect(reach.unreached).toEqual([{ path: "lib/application.js", lines: [86] }]);
  });
});
