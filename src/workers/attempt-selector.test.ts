import { describe, expect, it } from "vitest";
import { emptyMeasureSnapshot, type MeasureSnapshot } from "../gates/measure-snapshot.ts";
import { emptyTestFileMeasures, type TestFileMeasures } from "../gates/measures.ts";
import { type Attempt, selectAttempt } from "./attempt-selector.ts";

function file(tests: number, assertions: number, skips = 0): TestFileMeasures {
  return { ...emptyTestFileMeasures, tests, assertions, skips };
}

function attempt(index: number, overrides: Partial<Attempt> = {}): Attempt {
  return {
    workerId: `task-1-attempt-${index}`,
    taskId: "task-1",
    attemptIndex: index,
    green: true,
    commit: "c".repeat(40),
    baseCommit: "b".repeat(40),
    measures: emptyMeasureSnapshot,
    erosions: 0,
    changedFiles: 1,
    addedLines: 10,
    ...overrides,
  };
}

function measuring(overrides: Partial<MeasureSnapshot>): MeasureSnapshot {
  return { ...emptyMeasureSnapshot, ...overrides };
}

describe("selecting between attempts at one task", () => {
  it("takes the attempt whose suite collected more tests", () => {
    const selection = selectAttempt("task-1", [
      attempt(0, { measures: measuring({ testsCollected: 4 }) }),
      attempt(1, { measures: measuring({ testsCollected: 7 }) }),
    ]);

    expect(selection.winner).toBe("task-1-attempt-1");
    expect(selection.decidedBy).toBe("testsCollected");
  });

  it("leaves out an attempt whose own gates were not green, and says so", () => {
    const selection = selectAttempt("task-1", [
      attempt(0, { green: false, commit: null, measures: measuring({ testsCollected: 99 }) }),
      attempt(1, { measures: measuring({ testsCollected: 2 }) }),
    ]);

    expect(selection.winner).toBe("task-1-attempt-1");
    expect(selection.order).toEqual(["task-1-attempt-1"]);
    const excluded = selection.attempts.find((one) => one.workerId === "task-1-attempt-0");
    expect(excluded).toMatchObject({ eligible: false, reason: "gates were not green" });
  });

  it("leaves out an attempt that proposed no commit", () => {
    const selection = selectAttempt("task-1", [attempt(0, { commit: null })]);

    expect(selection.winner).toBeNull();
    expect(selection.attempts[0]).toMatchObject({
      eligible: false,
      reason: "the attempt proposed no commit",
    });
  });

  it("puts a measured attempt above an unmeasured one rather than skipping the dimension", () => {
    const selection = selectAttempt("task-1", [
      attempt(0, { measures: measuring({ testsCollected: null }) }),
      attempt(1, { measures: measuring({ testsCollected: 1 }) }),
    ]);

    expect(selection.winner).toBe("task-1-attempt-1");
    expect(selection.decidedBy).toBe("testsCollected");
  });

  it("skips a dimension no attempt measured, and names the abstention", () => {
    const selection = selectAttempt("task-1", [
      attempt(0, { measures: measuring({ testsCollected: null }), addedLines: 40 }),
      attempt(1, { measures: measuring({ testsCollected: null }), addedLines: 4 }),
    ]);

    expect(selection.winner).toBe("task-1-attempt-1");
    expect(selection.decidedBy).toBe("addedLines");
    expect(selection.abstentions).toContainEqual({
      dimension: "testsCollected",
      reason: "no attempt measured it",
    });
  });

  it("prefers the attempt that covered more of the lines it changed", () => {
    const selection = selectAttempt("task-1", [
      attempt(0, { measures: measuring({ changedLinesCovered: 3, changedLinesMeasured: 3 }) }),
      attempt(1, { measures: measuring({ changedLinesCovered: 40, changedLinesMeasured: 44 }) }),
    ]);

    expect(selection.winner).toBe("task-1-attempt-1");
    expect(selection.decidedBy).toBe("changedLinesCovered");
  });

  it("falls to the smaller uncovered count only where the covered count ties", () => {
    const selection = selectAttempt("task-1", [
      attempt(0, { measures: measuring({ changedLinesCovered: 10, changedLinesMeasured: 20 }) }),
      attempt(1, { measures: measuring({ changedLinesCovered: 10, changedLinesMeasured: 12 }) }),
    ]);

    expect(selection.winner).toBe("task-1-attempt-1");
    expect(selection.decidedBy).toBe("uncoveredChangedLines");
  });

  it("gains an attempt nothing for opening a large test file it did not add to", () => {
    const atBase = { "big.test.ts": file(50, 100) };
    const selection = selectAttempt("task-1", [
      attempt(0, {
        measures: measuring({
          perTestFile: { "new.test.ts": file(2, 4) },
          perTestFileAtBase: atBase,
        }),
      }),
      attempt(1, {
        measures: measuring({
          perTestFile: { "big.test.ts": file(50, 100) },
          perTestFileAtBase: atBase,
        }),
      }),
    ]);

    expect(selection.winner).toBe("task-1-attempt-0");
    expect(selection.decidedBy).toBe("assertions");
  });

  it("prices an empty test at nothing by ranking assertions above test count", () => {
    const selection = selectAttempt("task-1", [
      attempt(0, { measures: measuring({ perTestFile: { "a.test.ts": file(6, 0) } }) }),
      attempt(1, { measures: measuring({ perTestFile: { "a.test.ts": file(2, 9) } }) }),
    ]);

    expect(selection.winner).toBe("task-1-attempt-1");
    expect(selection.decidedBy).toBe("assertions");
  });

  it("prefers fewer skip markers over a smaller diff", () => {
    const selection = selectAttempt("task-1", [
      attempt(0, {
        measures: measuring({ perTestFile: { "a.test.ts": file(2, 4, 3) } }),
        addedLines: 1,
      }),
      attempt(1, {
        measures: measuring({ perTestFile: { "a.test.ts": file(2, 4, 0) } }),
        addedLines: 500,
      }),
    ]);

    expect(selection.winner).toBe("task-1-attempt-1");
    expect(selection.decidedBy).toBe("skipMarkers");
  });

  it("prefers the attempt the ratchet never had to reject", () => {
    const selection = selectAttempt("task-1", [
      attempt(0, { erosions: 2 }),
      attempt(1, { erosions: 0 }),
    ]);

    expect(selection.winner).toBe("task-1-attempt-1");
    expect(selection.decidedBy).toBe("erosions");
  });

  it("breaks a tie on the earliest attempt rather than on anything a run can shape", () => {
    const selection = selectAttempt("task-1", [attempt(2), attempt(0), attempt(1)]);

    expect(selection.winner).toBe("task-1-attempt-0");
    expect(selection.decidedBy).toBeNull();
  });

  it("orders the same however the attempts arrive", () => {
    const attempts = [
      attempt(0, { measures: measuring({ testsCollected: 3 }) }),
      attempt(1, { measures: measuring({ testsCollected: 9 }) }),
      attempt(2, { measures: measuring({ testsCollected: 3 }), addedLines: 2 }),
    ];
    const forwards = selectAttempt("task-1", attempts).order;
    const backwards = selectAttempt("task-1", [...attempts].reverse()).order;

    expect(backwards).toEqual(forwards);
  });

  it("names no winner when nothing was eligible", () => {
    const selection = selectAttempt("task-1", [attempt(0, { green: false, commit: null })]);

    expect(selection.winner).toBeNull();
    expect(selection.order).toEqual([]);
  });

  it("carries the commit the attempts were measured against", () => {
    const selection = selectAttempt("task-1", [attempt(0)]);

    expect(selection.baseCommit).toBe("b".repeat(40));
  });
});
