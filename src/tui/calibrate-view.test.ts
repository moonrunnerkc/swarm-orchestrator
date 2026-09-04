import { describe, expect, it } from "vitest";
import {
  applyCalibrateEvent,
  type CalibrateEvent,
  type CalibrateView,
  type CalibrationOutcome,
  describeVerdict,
  emptyCalibrateView,
  plannedRuns,
} from "./calibrate-view.ts";

const plan = {
  models: ["local:a", "local:b"],
  cases: 2,
  repeats: 3,
  goldenSetVersion: "sha256:aa",
};

function fold(events: readonly CalibrateEvent[]): CalibrateView {
  return events.reduce(applyCalibrateEvent, emptyCalibrateView);
}

function finished(over: Partial<Parameters<typeof outcomeOf>[0]> = {}) {
  return outcomeOf({
    model: "local:a",
    caseId: "edit-one",
    repeat: 1,
    executed: true,
    gatePassed: true,
    abstentionReason: null,
    ...over,
  });
}

function outcomeOf(outcome: {
  model: string;
  caseId: string;
  repeat: number;
  executed: boolean;
  gatePassed: boolean | null;
  abstentionReason: string | null;
}): CalibrateEvent {
  return { type: "run-finished", outcome };
}

describe("the sweep's denominator", () => {
  it("is unknown until the plan is", () => {
    expect(plannedRuns(null)).toBeNull();
  });

  it("is models times cases times repeats", () => {
    expect(plannedRuns(plan)).toBe(12);
  });
});

describe("what the projection counts", () => {
  it("lays out a row per model in the order the plan named them", () => {
    const view = fold([{ type: "plan", plan }]);

    expect(view.tallies.map((tally) => tally.model)).toEqual(["local:a", "local:b"]);
    expect(view.tallies.every((tally) => tally.finished === 0)).toBe(true);
  });

  it("counts a green run against the model that ran it", () => {
    const view = fold([{ type: "plan", plan }, finished()]);

    expect(view.tallies[0]).toMatchObject({ finished: 1, executed: 1, green: 1 });
    expect(view.tallies[1]).toMatchObject({ finished: 0, executed: 0, green: 0 });
  });

  it("counts a run that measured nothing as finished but not executed", () => {
    const view = fold([
      { type: "plan", plan },
      finished({ executed: false, gatePassed: true, abstentionReason: "no-content" }),
    ]);

    expect(view.tallies[0]).toMatchObject({ finished: 1, executed: 0, green: 0 });
  });

  it("refuses to call a gate that passed over an unmeasured run green", () => {
    // The gate ran over a workspace no attempt was made on. That is not the model solving it,
    // and counting it would be the screen reporting a number nothing measured.
    const view = fold([
      { type: "plan", plan },
      finished({ executed: false, gatePassed: true, abstentionReason: "no-content" }),
    ]);

    expect(view.tallies[0]?.green).toBe(0);
  });

  it("counts abstentions by the reason code, never by a guess", () => {
    const view = fold([
      { type: "plan", plan },
      finished({ executed: false, gatePassed: false, abstentionReason: "no-content" }),
      finished({ executed: false, gatePassed: false, abstentionReason: "no-content" }),
      finished({ executed: false, gatePassed: false, abstentionReason: "call-failed" }),
    ]);

    expect(view.tallies[0]?.abstentions).toEqual({ "no-content": 2, "call-failed": 1 });
  });

  it("names an unrecorded reason as unrecorded rather than as nothing", () => {
    const view = fold([
      { type: "plan", plan },
      finished({ executed: false, gatePassed: false, abstentionReason: null }),
    ]);

    expect(view.tallies[0]?.abstentions).toEqual({ unrecorded: 1 });
  });

  it("appends a model the plan did not name rather than dropping its run", () => {
    // The plan is what was asked for and the outcomes are what happened. A screen that
    // discarded a run because the two disagreed would hide the disagreement worth seeing.
    const view = fold([{ type: "plan", plan }, finished({ model: "local:unplanned" })]);

    expect(view.tallies.map((tally) => tally.model)).toEqual([
      "local:a",
      "local:b",
      "local:unplanned",
    ]);
  });

  it("counts every finished run, whichever model ran it", () => {
    const view = fold([
      { type: "plan", plan },
      finished(),
      finished({ model: "local:b" }),
      finished({ model: "local:b", gatePassed: false }),
    ]);

    expect(view.finished).toBe(3);
  });

  it("counts a run cut short before its gate as executed and never as green", () => {
    const view = fold([{ type: "plan", plan }, finished(), finished({ gatePassed: null })]);

    expect(view.tallies[0]).toMatchObject({ finished: 2, executed: 2, green: 1 });
  });

  it("names the three verdicts apart, so a screen cannot paint a cut-short run red", () => {
    const outcome = (finished() as { outcome: CalibrationOutcome }).outcome;
    expect(describeVerdict(outcome)).toBe("green");
    expect(describeVerdict({ ...outcome, gatePassed: false })).toBe("red");
    expect(describeVerdict({ ...outcome, gatePassed: null })).toBe("cut short before the gate");
    expect(describeVerdict({ ...outcome, executed: false, abstentionReason: "no-content" })).toBe(
      "not measured: no-content",
    );
  });
});

describe("the run in flight", () => {
  it("is what was last started", () => {
    const view = fold([
      { type: "plan", plan },
      { type: "run-started", current: { model: "local:a", caseId: "edit-one", repeat: 2 } },
    ]);

    expect(view.current).toEqual({ model: "local:a", caseId: "edit-one", repeat: 2 });
  });

  it("is nothing again once that run finishes", () => {
    const view = fold([
      { type: "plan", plan },
      { type: "run-started", current: { model: "local:a", caseId: "edit-one", repeat: 2 } },
      finished(),
    ]);

    expect(view.current).toBeNull();
  });
});

describe("the recent list", () => {
  it("is newest first", () => {
    const view = fold([
      { type: "plan", plan },
      finished({ caseId: "one" }),
      finished({ caseId: "two" }),
    ]);

    expect(view.recent.map((outcome) => outcome.caseId)).toEqual(["two", "one"]);
  });

  it("stays bounded, because a sweep is 180 runs and a screen is not", () => {
    const view = fold([
      { type: "plan", plan },
      ...Array.from({ length: 30 }, (_unused, index) => finished({ repeat: index })),
    ]);

    expect(view.recent).toHaveLength(8);
  });
});
