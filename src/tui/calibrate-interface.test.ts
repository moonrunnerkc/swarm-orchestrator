import { describe, expect, it } from "vitest";
import type { Clock } from "../core/clock.ts";
import { startCalibrateInterface } from "./calibrate-interface.ts";
import type { CalibrateEvent } from "./calibrate-view.ts";
import { resolveTheme } from "./theme.ts";

const clock: Clock = { now: () => 1_700_000_000_000, sleep: () => Promise.resolve() };
const theme = resolveTheme({ mode: "never", term: "dumb", noColorSet: true, isTty: false });

const plan: CalibrateEvent = {
  type: "plan",
  plan: { models: ["local:a"], cases: 2, repeats: 3, goldenSetVersion: "sha256:aa" },
};

function offTerminal(lines: string[]) {
  return startCalibrateInterface({
    isTty: false,
    interactive: true,
    theme,
    clock,
    bundleDirectory: "/tmp/bundle",
    writeLine: (line) => lines.push(line),
  });
}

describe("off a terminal", () => {
  it("writes one line per finished run, which is what a log wants", () => {
    const lines: string[] = [];
    const ui = offTerminal(lines);

    ui.apply(plan);
    ui.apply({
      type: "run-finished",
      outcome: {
        model: "local:a",
        caseId: "one",
        repeat: 1,
        executed: true,
        gatePassed: true,
        abstentionReason: null,
      },
    });

    expect(lines[0]).toBe("calibrating 1 model(s) over 2 case(s), 3 repeat(s) each");
    expect(lines[1]).toBe("  local:a  one #1  green");
  });

  it("says a run measured nothing in the same words the screen uses", () => {
    // One account of the run, whether it is read on a screen or in a log.
    const lines: string[] = [];
    const ui = offTerminal(lines);

    ui.apply({
      type: "run-finished",
      outcome: {
        model: "local:a",
        caseId: "one",
        repeat: 2,
        executed: false,
        gatePassed: true,
        abstentionReason: "no-content",
      },
    });

    expect(lines[0]).toBe("  local:a  one #2  not measured: no-content");
  });

  it("writes nothing when a run starts, because a log has no line to overwrite", () => {
    const lines: string[] = [];
    const ui = offTerminal(lines);

    ui.apply({ type: "run-started", current: { model: "local:a", caseId: "one", repeat: 1 } });

    expect(lines).toEqual([]);
  });

  it("stops without a screen to take down", async () => {
    await expect(offTerminal([]).stop()).resolves.toBeUndefined();
  });
});

describe("on a terminal with the interface off", () => {
  it("falls back to the same lines, since --no-tui is a request for them", () => {
    const lines: string[] = [];
    const ui = startCalibrateInterface({
      isTty: true,
      interactive: false,
      theme,
      clock,
      bundleDirectory: "/tmp/bundle",
      writeLine: (line) => lines.push(line),
    });

    ui.apply(plan);

    expect(lines[0]).toContain("calibrating 1 model(s)");
  });
});
