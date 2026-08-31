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
      testReports: [],
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
      workspaceRoot: "/build",
      trackedTestFiles: [],
      testReports: [],
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

  it("counts a changed line the report never names as uncovered, not as covered", async () => {
    const probe = workspace();

    const measured = await takeMeasureSnapshot({
      changes: await probe.changes(),
      probe,
      workspaceRoot: "/build",
      trackedTestFiles: [],
      testReports: [],
      // Structurally complete, and it lists only lines it can say were reached. Reading misses
      // rather than hits made this 4/4: what a report leaves out, it did not measure.
      coverageReports: [["SF:src/math.ts", "DA:2,1", "LF:1", "LH:1", "end_of_record"].join("\n")],
    });

    expect(measured.changedLinesMeasured).toBe(4);
    expect(measured.changedLinesCovered).toBe(1);
    expect(measured.changedLineCoverage).toBe(0.25);
  });

  /**
   * This used to read 0.5: the two sections were merged and the lower count won where they
   * disagreed, so a section with nothing to say could not shadow one with misses. Merging is
   * exactly what a forged second section needs, and the honest reading of a file two sections
   * describe is that no single section measured it.
   */
  it("says nothing about a file more than one section describes", async () => {
    const probe = workspace();

    const measured = await takeMeasureSnapshot({
      changes: await probe.changes(),
      probe,
      workspaceRoot: "/workspace",
      trackedTestFiles: [],
      testReports: [],
      coverageReports: [
        [
          "SF:src/math.ts",
          "DA:2,1",
          "DA:3,1",
          "DA:4,1",
          "DA:5,1",
          "LF:4",
          "LH:4",
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

    expect(measured.changedLineCoverage).toBeNull();
    expect(measured.changedLinesMeasured).toBeNull();
  });

  it("does not read a line one section measured as coverage of the lines another names", async () => {
    // Both sections are complete, both name exactly the changed file, and together their line
    // numbers cover every changed line. The first measured one line; the second is a claim
    // about the other eight, and unioning their keys read the pair as nine of nine.
    const probe = createMemoryWorkspace({
      base: { "clamp.mjs": "export const nothing = 0;\n" },
      current: { "clamp.mjs": Array.from({ length: 9 }, (_unused, at) => `line ${at}`).join("\n") },
    });

    const measured = await takeMeasureSnapshot({
      changes: await probe.changes(),
      probe,
      workspaceRoot: "/workspace",
      trackedTestFiles: [],
      testReports: [],
      coverageReports: [
        [
          "SF:clamp.mjs",
          "DA:1,1",
          "LF:1",
          "LH:1",
          "end_of_record",
          "SF:clamp.mjs",
          ...Array.from({ length: 8 }, (_unused, at) => `DA:${at + 2},1`),
          "LF:8",
          "LH:8",
          "end_of_record",
        ].join("\n"),
      ],
    });

    expect(measured.changedLinesCovered).not.toBe(9);
    expect(measured.changedLineCoverage).toBeNull();
  });

  it("says nothing about a file only a same-named section elsewhere mentions", async () => {
    const probe = workspace();

    const measured = await takeMeasureSnapshot({
      changes: await probe.changes(),
      probe,
      workspaceRoot: "/workspace",
      trackedTestFiles: [],
      testReports: [],
      coverageReports: [
        [
          "SF:vendor/math.ts",
          "DA:1,1",
          "DA:2,1",
          "DA:3,1",
          "DA:4,1",
          "DA:5,1",
          "LF:5",
          "LH:5",
          "end_of_record",
          "SF:/opt/other/math.ts",
          "DA:1,1",
          "LF:1",
          "LH:1",
          "end_of_record",
        ].join("\n"),
      ],
    });

    // Two complete, fully hit sections, neither of them about the file that changed.
    expect(measured.changedLineCoverage).toBeNull();
    expect(measured.changedLinesMeasured).toBeNull();
  });

  it("says nothing about a file no report mentions, rather than calling it uncovered", async () => {
    const probe = workspace();

    const measured = await takeMeasureSnapshot({
      changes: await probe.changes(),
      probe,
      trackedTestFiles: [],
      testReports: [],
      coverageReports: ["SF:src/elsewhere.ts\nDA:1,0\nLF:1\nLH:0\nend_of_record"],
    });

    expect(measured.changedLineCoverage).toBeNull();
  });
});
