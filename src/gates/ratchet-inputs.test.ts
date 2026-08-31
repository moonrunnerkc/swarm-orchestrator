import { describe, expect, it } from "vitest";
import {
  emptyMeasureSnapshot,
  type MeasureSnapshot,
  takeMeasureSnapshot,
} from "./measure-snapshot.ts";
import { judgeRatchet, ratchetPayload } from "./ratchet.ts";
import { createMemoryWorkspace } from "./test-doubles.ts";

/**
 * The trust boundary the inventory in docs/ratchet-inputs.md draws, held as tests.
 *
 * Two properties, and the second is the one that keeps the first honest: no numeric the ratchet
 * compares may be taken from output the code under measurement authored, and a measure the
 * harness could not obtain has to arrive as a named abstention rather than as a number that
 * happens to compare equal.
 */

const changed = [
  "export const n = 1;",
  "export function twice(x) {",
  "  return x * 2;",
  "}",
  "",
].join("\n");

function workspace() {
  return createMemoryWorkspace({
    base: { "src/math.ts": "export const n = 1;\n" },
    current: { "src/math.ts": changed },
  });
}

describe("what the ratchet's numerics are allowed to come from", () => {
  it("takes no collected count from a cycle that wrote no result, whatever it printed", async () => {
    const probe = workspace();

    const measured = await takeMeasureSnapshot({
      changes: await probe.changes(),
      probe,
      trackedTestFiles: [],
      coverageReports: [],
      testCountReports: [],
    });

    expect(measured.testsCollected).toBeNull();
    expect(measured.testsSkippedByRunner).toBeNull();
  });

  it("takes it from the result the runner wrote, which is the only source there is", async () => {
    const probe = workspace();

    const measured = await takeMeasureSnapshot({
      changes: await probe.changes(),
      probe,
      trackedTestFiles: [],
      coverageReports: [],
      testCountReports: ["TAP version 13\n1..2\n# tests 2\n# pass 2\n# fail 0\n# skipped 0\n"],
    });

    expect(measured.testsCollected).toBe(2);
    expect(measured.testsSkippedByRunner).toBe(0);
  });
});

describe("what an unmeasured arm produces", () => {
  const bothUnmeasured = judgeRatchet({
    baselineGates: {},
    candidateGates: {},
    baseline: emptyMeasureSnapshot,
    candidate: emptyMeasureSnapshot,
  });

  it("is a named abstention, never a comparison that happened to hold", () => {
    expect(bothUnmeasured.abstentions).toEqual([
      {
        measure: "testsCollected",
        reason: "nothing measured this on either side of the attempt",
      },
      {
        measure: "changedLineCoverage",
        reason: "nothing measured this on either side of the attempt",
      },
    ]);
    expect(bothUnmeasured.violations).toEqual([]);
  });

  it("names the arms in the detail, so an abstention does not read as a pass", () => {
    expect(bothUnmeasured.detail).toContain("not compared: testsCollected, changedLineCoverage");
  });

  it("abstains rather than comparing where only one side measured", () => {
    const measured: MeasureSnapshot = { ...emptyMeasureSnapshot, testsCollected: 9 };
    const decision = judgeRatchet({
      baselineGates: {},
      candidateGates: {},
      baseline: measured,
      candidate: emptyMeasureSnapshot,
    });

    expect(decision.violations).toEqual([]);
    expect(decision.abstentions).toContainEqual({
      measure: "testsCollected",
      reason: "it was measured on only one side of the attempt, so there is nothing to compare",
    });
  });

  it("records the abstention and a null measure, rather than a default the reader would trust", () => {
    const input = {
      baselineGates: {},
      candidateGates: {},
      baseline: emptyMeasureSnapshot,
      candidate: emptyMeasureSnapshot,
    };
    const payload = ratchetPayload("retry", 1, input, judgeRatchet(input), []);

    // Null and not zero: a zero is a measurement, and this is the absence of one.
    expect(payload.measures.before.testsCollected).toBeNull();
    expect(payload.measures.after.changedLineCoverage).toBeNull();
    expect(payload.abstentions.map((abstention) => abstention.measure)).toEqual([
      "testsCollected",
      "changedLineCoverage",
    ]);
  });
});
