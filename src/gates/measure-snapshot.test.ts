import { describe, expect, it } from "vitest";
import { takeMeasureSnapshot } from "./measure-snapshot.ts";
import { createMemoryWorkspace } from "./test-doubles.ts";

/**
 * The coverage arm reads runner-authored reports and nothing else. What a gate printed is not
 * an input to this function any more, which is the point: a number the harness did not obtain
 * from a file the runner wrote is not evidence, so the arm abstains instead.
 */

const changed = [
  "export const n = 1;",
  "export function dead(x) {",
  "  if (x < 0) return -1;",
  "  return x;",
  "}",
  "",
].join("\n");

function workspace() {
  return createMemoryWorkspace({
    base: { "src/math.ts": "export const n = 1;\n" },
    current: { "src/math.ts": changed },
  });
}

describe("changed-line coverage", () => {
  it("is not measured when no runner wrote a report", async () => {
    const probe = workspace();

    const measured = await takeMeasureSnapshot({
      changes: await probe.changes(),
      probe,
      trackedTestFiles: [],
      gateMeasures: {},
      coverageReports: [],
    });

    expect(measured.changedLineCoverage).toBeNull();
    expect(measured.changedLinesMeasured).toBeNull();
  });

  it("comes out of the runner's lcov, per changed line", async () => {
    const probe = workspace();

    const measured = await takeMeasureSnapshot({
      changes: await probe.changes(),
      probe,
      trackedTestFiles: [],
      gateMeasures: {},
      coverageReports: [
        [
          "SF:/build/src/math.ts",
          "DA:2,1",
          "DA:3,0",
          "DA:4,0",
          "DA:5,1",
          "LF:4",
          "LH:2",
          "end_of_record",
        ].join("\n"),
      ],
    });

    // Lines 2 to 5 are the added ones; the report says two of the four were never reached.
    expect(measured.changedLinesMeasured).toBe(4);
    expect(measured.changedLinesCovered).toBe(2);
    expect(measured.changedLineCoverage).toBe(0.5);
  });

  it("does not let an empty section for one path spelling hide misses under another", async () => {
    const probe = workspace();

    const measured = await takeMeasureSnapshot({
      changes: await probe.changes(),
      probe,
      trackedTestFiles: [],
      gateMeasures: {},
      coverageReports: [
        [
          "SF:src/math.ts",
          "DA:2,1",
          "LF:1",
          "LH:1",
          "end_of_record",
          "SF:/workspace/src/math.ts",
          "DA:3,0",
          "DA:4,0",
          "LF:2",
          "LH:0",
          "end_of_record",
        ].join("\n"),
      ],
    });

    expect(measured.changedLineCoverage).toBe(0.5);
  });

  it("says nothing about a file no report mentions, rather than calling it uncovered", async () => {
    const probe = workspace();

    const measured = await takeMeasureSnapshot({
      changes: await probe.changes(),
      probe,
      trackedTestFiles: [],
      gateMeasures: {},
      coverageReports: ["SF:src/elsewhere.ts\nDA:1,0\nLF:1\nLH:0\nend_of_record"],
    });

    expect(measured.changedLineCoverage).toBeNull();
  });
});
