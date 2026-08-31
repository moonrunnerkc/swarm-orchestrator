import { describe, expect, it } from "vitest";
import type { CalibrationRepeatObservation } from "../select/calibration-run.ts";
import { buildCalibrateScreen } from "./calibrate-screen-model.ts";
import {
  applyCalibrateEvent,
  type CalibratePlan,
  type CalibrateView,
  emptyCalibrateView,
  plannedRepeats,
} from "./calibrate-view.ts";
import { resolveTheme } from "./theme.ts";

/**
 * The calibrate screen, at four widths and with colour off, the way the session screen is
 * tested: over the pure function, with no renderer.
 */

const plan: CalibratePlan = {
  models: ["local:small", "local:large"],
  cases: 2,
  repeats: 3,
  goldenSetVersion: "v1",
  backend: "http://127.0.0.1:11434/v1",
};

const theme = resolveTheme({ mode: "never", term: undefined, noColorSet: true, isTty: false });

function observation(
  overrides: Partial<CalibrationRepeatObservation> = {},
): CalibrationRepeatObservation {
  return {
    caseId: "edit-loud-greeting",
    caseDigest: "sha256:aa",
    taskClass: "edit",
    model: "local:small",
    repeat: 1,
    workspace: "/scratch",
    stopReason: "completed",
    steps: 2,
    executed: true,
    abstention: null,
    gateExitCode: 0,
    gatePassed: true,
    toolCalls: {
      attempted: 1,
      malformed: 0,
      writesAttempted: 1,
      writesApplied: 1,
      validityRate: 1,
      applyRate: 1,
    },
    modelCalls: {
      calls: 2,
      outputTokens: 40,
      responseTimeMs: 1_000,
      firstTokenMs: 100,
      tokensPerSecond: 40,
    },
    peakMemoryBytes: null,
    record: "sha256:bb",
    ...overrides,
  };
}

function viewAfter(...events: Parameters<typeof applyCalibrateEvent>[1][]): CalibrateView {
  return events.reduce(applyCalibrateEvent, emptyCalibrateView);
}

function textAt(width: number, view: CalibrateView): string {
  return buildCalibrateScreen({ view, columns: width, rows: 40, theme, elapsedMs: 61_000 })
    .map((row) => row.text)
    .join("\n");
}

describe("what the sweep's screen says before anything has run", () => {
  const view = viewAfter({ type: "planned", plan });

  it("names the denominator it knew before it started", () => {
    expect(plannedRepeats(plan)).toBe(12);
    expect(textAt(100, view)).toContain("0 of 12 repeat(s)");
  });

  it("names the golden set, the backend, and how long it has been going", () => {
    const text = textAt(120, view);

    expect(text).toContain("golden set v1");
    expect(text).toContain("http://127.0.0.1:11434/v1");
    expect(text).toContain("1m 01s");
  });

  it("lists every model from the start, so a row does not appear partway down", () => {
    const text = textAt(100, view);

    expect(text).toContain("local:small");
    expect(text).toContain("local:large");
    expect(text).toContain("0/6 run");
  });

  it("says it is running rather than saying nothing", () => {
    expect(textAt(100, view)).toContain("running  0 of 12");
  });
});

describe("what it says while a repeat is in flight", () => {
  it("names the model, the case and the repeat", () => {
    const view = viewAfter(
      { type: "planned", plan },
      {
        type: "repeat-started",
        run: { model: "local:small", caseId: "edit-loud-greeting", repeat: 2, startedAtMs: 0 },
      },
    );

    expect(textAt(120, view)).toContain("local:small  edit-loud-greeting  repeat 2");
  });

  it("stops naming one once it has finished", () => {
    const view = viewAfter(
      { type: "planned", plan },
      {
        type: "repeat-started",
        run: { model: "local:small", caseId: "edit-loud-greeting", repeat: 2, startedAtMs: 0 },
      },
      { type: "repeat-finished", observation: observation() },
    );

    expect(textAt(120, view)).not.toContain("repeat 2");
  });
});

describe("what it counts", () => {
  it("counts a green repeat against the model that ran it", () => {
    const view = viewAfter(
      { type: "planned", plan },
      { type: "repeat-finished", observation: observation() },
    );

    expect(textAt(120, view)).toContain("1/6 run  1 executed  1 green");
  });

  it("does not count a repeat the model never answered as green, whatever the gate exited", () => {
    // The number that made a calibration report look like a measurement: the seeded workspace
    // passes its own command untouched, so a run that did nothing exits zero.
    const view = viewAfter(
      { type: "planned", plan },
      {
        type: "repeat-finished",
        observation: observation({
          executed: false,
          gatePassed: true,
          abstention: {
            reason: "every-turn-empty",
            turns: 3,
            emptyTurns: 3,
            unreadTurns: 0,
            emptyReasons: { "no-content": 3 },
          },
        }),
      },
    );

    expect(textAt(140, view)).toContain("1/6 run  0 executed  0 green");
  });

  it("names why a repeat measured nothing, rather than leaving a reader to guess", () => {
    const view = viewAfter(
      { type: "planned", plan },
      {
        type: "repeat-finished",
        observation: observation({
          executed: false,
          abstention: {
            reason: "every-turn-empty",
            turns: 3,
            emptyTurns: 3,
            unreadTurns: 0,
            emptyReasons: { "no-content": 3 },
          },
        }),
      },
    );

    expect(textAt(140, view)).toContain("(1 every-turn-empty)");
  });

  it("counts a repeat for a model the plan did not name, rather than dropping it", () => {
    const view = viewAfter(
      { type: "planned", plan },
      { type: "repeat-finished", observation: observation({ model: "local:surprise" }) },
    );

    expect(textAt(120, view)).toContain("local:surprise");
  });
});

describe("what it says when the sweep is over", () => {
  it("names the pick", () => {
    const view = viewAfter({ type: "planned", plan }, { type: "settled", pick: "local:small" });

    expect(textAt(100, view)).toContain("DONE  local:small");
  });

  it("renders an abstain as an abstain, never as a pick nobody made", () => {
    const view = viewAfter({ type: "planned", plan }, { type: "settled", pick: null });

    expect(textAt(100, view)).toContain("calibration abstained");
  });
});

describe("how it fits the terminal it is drawn on", () => {
  const view = viewAfter(
    { type: "planned", plan },
    { type: "repeat-finished", observation: observation() },
    {
      type: "repeat-started",
      run: { model: "local:small", caseId: "edit-loud-greeting", repeat: 2, startedAtMs: 0 },
    },
  );

  it("keeps every row inside the width, at every width", () => {
    for (const columns of [40, 60, 80, 120]) {
      const rows = buildCalibrateScreen({ view, columns, rows: 40, theme, elapsedMs: 1_000 });
      for (const row of rows) {
        expect(row.text.length).toBeLessThanOrEqual(columns);
      }
    }
  });

  it("never draws more rows than the terminal has", () => {
    for (const rowCount of [1, 4, 8, 40]) {
      expect(
        buildCalibrateScreen({ view, columns: 80, rows: rowCount, theme, elapsedMs: 1_000 }).length,
      ).toBeLessThanOrEqual(rowCount);
    }
  });

  it("colours nothing when colour is off", () => {
    const rows = buildCalibrateScreen({ view, columns: 80, rows: 40, theme, elapsedMs: 1_000 });

    expect(rows.every((row) => row.color === undefined)).toBe(true);
  });
});
