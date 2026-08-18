import { describe, expect, it } from "vitest";
import type { CalibrationRepeatObservation } from "./calibration-run.ts";
import { summarizeByModel } from "./calibration-summary.ts";

function observation(
  overrides: Partial<CalibrationRepeatObservation> = {},
): CalibrationRepeatObservation {
  return {
    caseId: "edit-loud-greeting",
    caseDigest: "sha256:aa",
    taskClass: "edit",
    model: "local:small",
    repeat: 1,
    workspace: "/scratch/one",
    stopReason: "completed",
    steps: 2,
    gateExitCode: 0,
    gatePassed: true,
    toolCalls: {
      attempted: 4,
      malformed: 0,
      writesAttempted: 2,
      writesApplied: 2,
      validityRate: 1,
      applyRate: 1,
    },
    modelCalls: {
      calls: 2,
      outputTokens: 100,
      responseTimeMs: 2_000,
      firstTokenMs: 200,
      tokensPerSecond: 50,
    },
    peakMemoryBytes: 4_000_000,
    record: "sha256:run1",
    ...overrides,
  };
}

describe("summarizeByModel", () => {
  it("summarizes each model separately, in the order they were first seen", () => {
    const summaries = summarizeByModel([
      observation({ model: "local:small" }),
      observation({ model: "local:big" }),
      observation({ model: "local:small", repeat: 2 }),
    ]);

    expect(summaries.map((summary) => summary.model)).toEqual(["local:small", "local:big"]);
    expect(summaries[0]?.repeats).toBe(2);
  });

  it("scores all six dimensions and never merges them", () => {
    const summary = summarizeByModel([observation()])[0];

    expect(Object.keys(summary?.dimensions ?? {}).sort()).toEqual(
      [
        "gate-pass",
        "patch-apply",
        "peak-memory",
        "time-to-first-token",
        "tokens-per-second",
        "tool-call-validity",
      ].sort(),
    );
  });

  it("reads a gate pass as one and a failure as zero, so the share is a distribution", () => {
    const summary = summarizeByModel([
      observation({ gatePassed: true }),
      observation({ repeat: 2, gatePassed: false, gateExitCode: 1 }),
      observation({ repeat: 3, gatePassed: true }),
    ])[0];

    expect(summary?.dimensions["gate-pass"]).toMatchObject({ samples: 3, min: 0, max: 1 });
    expect(summary?.dimensions["gate-pass"]?.mean).toBeCloseTo(2 / 3, 10);
  });

  it("shows the spread across repeats, not only the middle", () => {
    const summary = summarizeByModel([
      observation({ modelCalls: { ...observation().modelCalls, tokensPerSecond: 20 } }),
      observation({
        repeat: 2,
        modelCalls: { ...observation().modelCalls, tokensPerSecond: 60 },
      }),
    ])[0];

    expect(summary?.dimensions["tokens-per-second"]).toMatchObject({ min: 20, max: 60, mean: 40 });
    expect(summary?.dimensions["tokens-per-second"]?.deviation).toBe(20);
  });

  it("keeps a dimension nothing measured as unmeasured rather than zero", () => {
    const summary = summarizeByModel([observation({ peakMemoryBytes: null })])[0];

    expect(summary?.dimensions["peak-memory"]).toMatchObject({
      samples: 0,
      unmeasured: 1,
      median: null,
    });
  });

  it("breaks the result down by case, so a stratified set reads as strata", () => {
    const summary = summarizeByModel([
      observation({ caseId: "a", taskClass: "edit", gatePassed: true }),
      observation({ caseId: "a", taskClass: "edit", repeat: 2, gatePassed: false }),
      observation({ caseId: "b", taskClass: "test-fix", gatePassed: true }),
    ])[0];

    expect(summary?.byCase).toEqual([
      { caseId: "a", taskClass: "edit", repeats: 2, gatePassed: 1, didNotRun: 0 },
      { caseId: "b", taskClass: "test-fix", repeats: 1, gatePassed: 1, didNotRun: 0 },
    ]);
  });

  /**
   * Found while calibrating a frontier model whose credit ran out ten cases in. The last
   * ten cases rendered "0 of 3 green", identical to a model that cannot do them, and the
   * ten that had already run rendered "3 of 3". Reading the first as a measurement of the
   * model would have been a claim about something that never executed, which is the
   * distinction invariant 7 makes for coverage and this report was not making.
   */
  it("counts a repeat the model never answered apart from one whose gate failed", () => {
    const summary = summarizeByModel([
      observation({ caseId: "a", stopReason: "model-error", gatePassed: false, gateExitCode: 1 }),
      observation({ caseId: "a", stopReason: "model-error", gatePassed: false, gateExitCode: 1 }),
      observation({ caseId: "a", stopReason: "completed", gatePassed: false, gateExitCode: 1 }),
    ])[0];

    expect(summary?.byCase).toEqual([
      { caseId: "a", taskClass: "edit", repeats: 3, gatePassed: 0, didNotRun: 2 },
    ]);
  });

  it("does not count a run that finished and failed its gate as one that did not run", () => {
    const summary = summarizeByModel([
      observation({ caseId: "a", stopReason: "max-steps", gatePassed: false, gateExitCode: 1 }),
    ])[0];

    expect(summary?.byCase[0]?.didNotRun).toBe(0);
  });

  it("carries the record of every repeat it summarized, so each score has its runs", () => {
    const summary = summarizeByModel([
      observation({ record: "sha256:one" }),
      observation({ repeat: 2, record: "sha256:two" }),
    ])[0];

    expect(summary?.runRecords).toEqual(["sha256:one", "sha256:two"]);
  });
});
