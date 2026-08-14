import { describe, expect, it } from "vitest";
import { emptyMeasureSnapshot, type MeasureSnapshot } from "./measure-snapshot.ts";
import type { RatchetDecision } from "./ratchet.ts";
import { summarizeRatchet } from "./ratchet-summary.ts";

function accepted(): RatchetDecision {
  return { accepted: true, violations: [], abstentions: [], exemptFiles: [], detail: "fine" };
}

function eroded(): RatchetDecision {
  return {
    accepted: false,
    violations: [
      {
        kind: "tests-declared-decreased",
        before: 12,
        after: 8,
        detail: "the touched test files declared 12 test(s) and now declare 8",
      },
    ],
    abstentions: [],
    exemptFiles: [],
    detail: "rejected",
  };
}

function crashed(): RatchetDecision {
  return {
    accepted: false,
    violations: [],
    abstentions: [],
    exemptFiles: [],
    detail: "the attempt produced nothing to judge: the model went away",
  };
}

const measures: MeasureSnapshot = {
  ...emptyMeasureSnapshot,
  perTestFile: {
    "src/a.test.ts": {
      tests: 9,
      assertions: 21,
      skips: 1,
      assertionsBySubject: {},
      exactSubjects: [],
    },
  },
  testsCollected: 47,
  changedLineCoverage: 0.82,
};

describe("summarizeRatchet", () => {
  it("counts the attempts and how many the ratchet turned down", () => {
    const summary = summarizeRatchet({
      settled: "green",
      attempts: [{ decision: eroded() }, { decision: accepted() }],
      finalMeasures: measures,
    });

    expect(summary).toMatchObject({ attempts: 2, rejected: 1, erosions: 1 });
  });

  it("separates an attempt that traded a number away from one that merely crashed", () => {
    // Both are rejections, but only one is the pattern the reward is meant to punish.
    const summary = summarizeRatchet({
      settled: "escalated",
      attempts: [{ decision: crashed() }],
      finalMeasures: measures,
    });

    expect(summary).toMatchObject({ attempts: 1, rejected: 1, erosions: 0 });
  });

  it("carries the numbers as they stand at the end, so the log holds the measures", () => {
    const summary = summarizeRatchet({
      settled: "green",
      attempts: [],
      finalMeasures: measures,
    });

    expect(summary).toMatchObject({
      testsCollected: 47,
      testsDeclared: 9,
      assertions: 21,
      skipMarkers: 1,
      changedLineCoverage: 0.82,
    });
  });

  it("keeps an unmeasured number null rather than reporting it as zero", () => {
    const summary = summarizeRatchet({
      settled: "green",
      attempts: [],
      finalMeasures: emptyMeasureSnapshot,
    });

    expect(summary.testsCollected).toBeNull();
    expect(summary.changedLineCoverage).toBeNull();
    expect(summary.testsDeclared).toBe(0);
  });
});
