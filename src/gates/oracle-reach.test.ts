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

  it("says no when added lines were never executed", () => {
    const reach = oracleReachedTheChange({
      changed,
      covered: { "lib/application.js": [85, 265] },
    });

    expect(reach.reached).toBe(false);
    expect(reach.unreached).toEqual([{ path: "lib/application.js", lines: [270, 271] }]);
  });

  it("says yes when every added line ran", () => {
    const reach = oracleReachedTheChange({
      changed,
      covered: { "lib/application.js": [85, 265, 270, 271, 999] },
    });

    expect(reach.reached).toBe(true);
    expect(reach.unreached).toEqual([]);
  });

  // No report is not a report of full coverage. An oracle whose reach could not be measured is
  // not shown to have judged anything, and saying otherwise is the collapse of unmeasured into
  // pass that the rest of this project refuses.
  it("does not claim reach for a file the report never mentions", () => {
    const reach = oracleReachedTheChange({ changed, covered: {} });

    expect(reach.reached).toBe(false);
    expect(reach.unreached).toEqual([{ path: "lib/application.js", lines: [85, 265, 270, 271] }]);
  });

  it("ignores a file the patch did not add lines to", () => {
    const reach = oracleReachedTheChange({
      changed: [{ path: "README.md", addedLines: [] }],
      covered: {},
    });

    expect(reach.reached).toBe(true);
  });
});
