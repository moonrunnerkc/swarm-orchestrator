import { describe, expect, it } from "vitest";
import {
  compareWithShortlist,
  pickFromCalibration,
  renderCalibrationReport,
} from "./calibration-report.ts";
import type { CalibrationRepeatObservation } from "./calibration-run.ts";
import { type ModelSummary, summarizeByModel } from "./calibration-summary.ts";

interface Shape {
  readonly model: string;
  readonly gatePassed?: boolean;
  readonly validity?: number | null;
  readonly apply?: number | null;
  readonly tokensPerSecond?: number | null;
  readonly firstTokenMs?: number | null;
  readonly peakMemoryBytes?: number | null;
  readonly caseId?: string;
  readonly repeat?: number;
  readonly stopReason?: CalibrationRepeatObservation["stopReason"];
}

function observation(shape: Shape): CalibrationRepeatObservation {
  return {
    caseId: shape.caseId ?? "edit-loud-greeting",
    caseDigest: "sha256:aa",
    taskClass: "edit",
    model: shape.model,
    repeat: shape.repeat ?? 1,
    workspace: "/scratch",
    stopReason: shape.stopReason ?? "completed",
    steps: 2,
    gateExitCode: shape.gatePassed === false ? 1 : 0,
    gatePassed: shape.gatePassed !== false,
    toolCalls: {
      attempted: 4,
      malformed: 0,
      writesAttempted: 2,
      writesApplied: 2,
      validityRate: shape.validity === undefined ? 1 : shape.validity,
      applyRate: shape.apply === undefined ? 1 : shape.apply,
    },
    modelCalls: {
      calls: 2,
      outputTokens: 100,
      responseTimeMs: 2_000,
      firstTokenMs: shape.firstTokenMs === undefined ? 200 : shape.firstTokenMs,
      tokensPerSecond: shape.tokensPerSecond === undefined ? 50 : shape.tokensPerSecond,
    },
    peakMemoryBytes: shape.peakMemoryBytes === undefined ? 4_000_000 : shape.peakMemoryBytes,
    record: `sha256:${shape.model}-${shape.repeat ?? 1}`,
    ...{},
  };
}

function summaries(shapes: readonly Shape[]): readonly ModelSummary[] {
  return summarizeByModel(shapes.map((shape) => observation(shape)));
}

describe("pickFromCalibration", () => {
  it("rejects a model that cannot form a tool call, naming the number", () => {
    const pick = pickFromCalibration(
      summaries([{ model: "sloppy", validity: 0.4 }, { model: "steady" }]),
    );

    expect(pick.model).toBe("steady");
    expect(pick.rejected).toEqual([
      {
        model: "sloppy",
        reason:
          "tool calls the chokepoint could act on came out at 0.400 share, under the 0.800 " +
          "a model needs to be usable at all",
      },
    ]);
  });

  it("rejects a model whose writes mostly fail", () => {
    const pick = pickFromCalibration(
      summaries([{ model: "clumsy", apply: 0.2 }, { model: "steady" }]),
    );

    expect(pick.model).toBe("steady");
    expect(pick.rejected[0]?.reason).toMatch(/writes that applied/);
  });

  it("takes the model that solved more of the set", () => {
    const pick = pickFromCalibration(
      summaries([
        { model: "weak", repeat: 1, gatePassed: false },
        { model: "weak", repeat: 2, gatePassed: true },
        { model: "strong", repeat: 1, gatePassed: true },
        { model: "strong", repeat: 2, gatePassed: true },
      ]),
    );

    expect(pick.model).toBe("strong");
    expect(pick.reasoning).toContain(
      "strong solved 1.000 of the set against weak's 0.500, on the same 4 runs",
    );
  });

  it("breaks a tie on cases solved with throughput", () => {
    const pick = pickFromCalibration(
      summaries([
        { model: "slow", tokensPerSecond: 12 },
        { model: "quick", tokensPerSecond: 48 },
      ]),
    );

    expect(pick.model).toBe("quick");
    expect(pick.reasoning.join(" ")).toMatch(/solved the same share.*48.*12/s);
  });

  it("breaks a further tie with the time to the first token", () => {
    const pick = pickFromCalibration(
      summaries([
        { model: "laggy", firstTokenMs: 900 },
        { model: "snappy", firstTokenMs: 150 },
      ]),
    );

    expect(pick.model).toBe("snappy");
    expect(pick.reasoning.join(" ")).toMatch(/time to first token/);
  });

  it("compares on more than one dimension, and never on a combined score", () => {
    const pick = pickFromCalibration(
      summaries([
        { model: "a", tokensPerSecond: 10 },
        { model: "b", tokensPerSecond: 40 },
      ]),
    );

    expect(pick.reasoning.length).toBeGreaterThan(1);
    expect(pick.reasoning.join(" ")).not.toMatch(/overall score|combined|total score/i);
  });

  it("picks nothing when no model is usable, and says what each fell short on", () => {
    const pick = pickFromCalibration(
      summaries([
        { model: "a", validity: 0.1 },
        { model: "b", apply: 0.1 },
      ]),
    );

    expect(pick.model).toBeNull();
    expect(pick.rejected).toHaveLength(2);
    expect(pick.reasoning[0]).toMatch(/no model cleared/);
  });

  it("does not reject a model on a dimension nothing measured", () => {
    const pick = pickFromCalibration(summaries([{ model: "only", validity: null, apply: null }]));

    expect(pick.model).toBe("only");
  });
});

describe("compareWithShortlist", () => {
  const measured = summaries([
    { model: "local:big", repeat: 1, gatePassed: true },
    { model: "local:small", repeat: 1, gatePassed: false },
  ]);

  it("reports agreement as corroboration of the shortlist", () => {
    const pick = pickFromCalibration(measured);

    const comparison = compareWithShortlist(pick, "local:big", measured);

    expect(comparison.agrees).toBe(true);
    expect(comparison.statement).toMatch(/corroborates the shortlist/);
  });

  it("explains a divergence with the dimension and both numbers", () => {
    const pick = pickFromCalibration(measured);

    const comparison = compareWithShortlist(pick, "local:small", measured);

    expect(comparison.agrees).toBe(false);
    expect(comparison.statement).toMatch(
      /diverges.*local:big reached 1\.000.*cases whose gate went green.*local:small reached 0\.000/s,
    );
  });

  it("says plainly when the static pick was never measured", () => {
    const pick = pickFromCalibration(measured);

    const comparison = compareWithShortlist(pick, "local:unmeasured", measured);

    expect(comparison.statement).toMatch(/was not among the models calibrated/);
  });

  it("says there was nothing to corroborate when the shortlist recommended nothing", () => {
    const comparison = compareWithShortlist(pickFromCalibration(measured), null, measured);

    expect(comparison.statement).toMatch(/no static recommendation/);
  });
});

describe("renderCalibrationReport", () => {
  const measured = summaries([
    { model: "local:big", repeat: 1, gatePassed: true, tokensPerSecond: 20 },
    { model: "local:big", repeat: 2, gatePassed: true, tokensPerSecond: 30 },
    { model: "local:small", repeat: 1, gatePassed: false, tokensPerSecond: 80 },
    { model: "local:small", repeat: 2, gatePassed: true, tokensPerSecond: 90 },
  ]);
  const pick = pickFromCalibration(measured);

  function report(): string {
    return renderCalibrationReport({
      goldenSetVersion: `sha256:${"cd".repeat(32)}`,
      cases: 4,
      repeats: 3,
      models: measured,
      pick,
      comparison: compareWithShortlist(pick, "local:big", measured),
      bundleDirectory: "/home/dev/.swarm/sessions/x/bundle",
    }).join("\n");
  }

  it("names the golden set it measured against", () => {
    expect(report()).toContain(`golden set        sha256:${"cd".repeat(32)}`);
  });

  it("shows a spread per dimension per model, never a single number", () => {
    expect(report()).toMatch(/local:big[\s\S]*output tokens per second\s+20\.0\s+25\.0\s+30\.0/);
  });

  it("says how many repeats stood behind each distribution", () => {
    expect(report()).toMatch(/cases whose gate went green\s+[\d.]+\s+[\d.]+\s+[\d.]+\s+2/);
  });

  it("breaks each model down by case", () => {
    expect(report()).toMatch(/edit-loud-greeting/);
  });

  /**
   * A repeat the model never answered has to say so on the line a reader looks at. Both
   * halves are pinned: the case that ran and failed says nothing extra, and the case that
   * did not run says how many, because "0 of 3 green" is what a provider outage and a model
   * that cannot do the case both produce.
   */
  it("says on the case line when a repeat did not run, and not when one merely failed", () => {
    const withOutage = summaries([
      { model: "local:big", repeat: 1, caseId: "ran-and-failed", gatePassed: false },
      {
        model: "local:big",
        repeat: 1,
        caseId: "never-ran",
        gatePassed: false,
        stopReason: "model-error",
      },
      {
        model: "local:big",
        repeat: 2,
        caseId: "never-ran",
        gatePassed: false,
        stopReason: "model-error",
      },
    ]);
    const rendered = renderCalibrationReport({
      goldenSetVersion: `sha256:${"cd".repeat(32)}`,
      cases: 2,
      repeats: 2,
      models: withOutage,
      pick: pickFromCalibration(withOutage),
      comparison: compareWithShortlist(pickFromCalibration(withOutage), "local:big", withOutage),
      bundleDirectory: "/home/dev/.swarm/sessions/x/bundle",
    }).join("\n");

    expect(rendered).toContain("never-ran (edit): 0 of 2 green, 2 did not run");
    expect(rendered).toContain("ran-and-failed (edit): 0 of 1 green\n");
  });

  it("gives the pick with its reasoning and the shortlist comparison", () => {
    expect(report()).toContain("pick              local:big");
    expect(report()).toMatch(/corroborates the shortlist/);
  });

  it("points at the bundle that proves it", () => {
    expect(report()).toContain("/home/dev/.swarm/sessions/x/bundle");
  });

  it("reads a big memory figure in gigabytes rather than a wall of digits", () => {
    const big = summaries([{ model: "hungry", peakMemoryBytes: 9_100_000_000 }]);
    const text = renderCalibrationReport({
      goldenSetVersion: "sha256:aa",
      cases: 1,
      repeats: 1,
      models: big,
      pick: pickFromCalibration(big),
      comparison: compareWithShortlist(pickFromCalibration(big), null, big),
      bundleDirectory: null,
    }).join("\n");

    expect(text).toMatch(/peak resident memory\s+9\.1G/);
  });

  it("marks a dimension nothing measured rather than printing a zero", () => {
    const unmeasured = summaries([{ model: "only", peakMemoryBytes: null }]);
    const text = renderCalibrationReport({
      goldenSetVersion: "sha256:aa",
      cases: 1,
      repeats: 1,
      models: unmeasured,
      pick: pickFromCalibration(unmeasured),
      comparison: compareWithShortlist(pickFromCalibration(unmeasured), null, unmeasured),
      bundleDirectory: null,
    }).join("\n");

    expect(text).toMatch(/peak resident memory\s+not measured/);
  });
});
