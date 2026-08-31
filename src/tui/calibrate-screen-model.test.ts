import { describe, expect, it } from "vitest";
import { buildCalibrateScreen } from "./calibrate-screen-model.ts";
import {
  applyCalibrateEvent,
  type CalibrateEvent,
  type CalibrateView,
  emptyCalibrateView,
} from "./calibrate-view.ts";
import { displayWidth } from "./terminal-text.ts";
import { resolveTheme } from "./theme.ts";

/**
 * The same shape the run screen is tested in: rows out of a pure function, asserted at several
 * widths and heights, with no renderer anywhere near it.
 */

const plan = {
  models: ["local:qwen3.6:35b-a3b", "local:gemma4:31b"],
  cases: 20,
  repeats: 3,
  goldenSetVersion: "sha256:3f0a67b2",
};

const theme = resolveTheme({ mode: "always", term: "xterm", noColorSet: false, isTty: true });
const monochrome = resolveTheme({ mode: "never", term: "xterm", noColorSet: true, isTty: false });

function viewOf(events: readonly CalibrateEvent[]): CalibrateView {
  return events.reduce(applyCalibrateEvent, emptyCalibrateView);
}

function screen(
  view: CalibrateView,
  over: Partial<Parameters<typeof buildCalibrateScreen>[0]> = {},
): readonly string[] {
  return buildCalibrateScreen({
    view,
    columns: 100,
    rows: 40,
    theme,
    elapsedMs: 65_000,
    bundleDirectory: "/tmp/bundle",
    ...over,
  }).map((row) => row.text);
}

function outcome(over: Record<string, unknown> = {}): CalibrateEvent {
  return {
    type: "run-finished",
    outcome: {
      model: "local:qwen3.6:35b-a3b",
      caseId: "edit-loud-greeting",
      repeat: 1,
      executed: true,
      gatePassed: true,
      abstentionReason: null,
      ...over,
    } as CalibrateEvent extends { outcome: infer O } ? O : never,
  };
}

describe("before the sweep has a plan", () => {
  it("says it is preparing rather than showing an empty grid", () => {
    const lines = screen(emptyCalibrateView);

    expect(lines[0]).toContain("swarm calibrate");
    expect(lines.join("\n")).toContain("preparing the sweep");
  });
});

describe("what the header says once the plan is known", () => {
  it("names the size of the sweep and how long it has been going", () => {
    const lines = screen(viewOf([{ type: "plan", plan }])).join("\n");

    expect(lines).toContain("2 model(s)");
    expect(lines).toContain("20 case(s)");
    expect(lines).toContain("3 repeat(s) each");
    expect(lines).toContain("1m 05s");
  });

  it("names the golden set, which is what makes two sweeps comparable", () => {
    expect(screen(viewOf([{ type: "plan", plan }])).join("\n")).toContain("sha256:3f0a67b2");
  });

  it("drops the golden set on a narrow terminal rather than wrapping it", () => {
    const lines = screen(viewOf([{ type: "plan", plan }]), { columns: 60 }).join("\n");

    expect(lines).not.toContain("golden set");
    expect(lines).toContain("2 model(s)");
  });
});

describe("progress", () => {
  it("is a count against a denominator, which a single run does not have", () => {
    const lines = screen(viewOf([{ type: "plan", plan }, outcome()])).join("\n");

    expect(lines).toContain("1 of 120 run(s) finished");
  });

  it("counts without a denominator before the plan arrives", () => {
    const lines = screen(viewOf([outcome()])).join("\n");

    expect(lines).toContain("1 run(s) finished");
    expect(lines).not.toContain(" of ");
  });

  it("names the run in flight", () => {
    const lines = screen(
      viewOf([
        { type: "plan", plan },
        { type: "run-started", current: { model: "local:gemma4:31b", caseId: "fix", repeat: 2 } },
      ]),
    ).join("\n");

    expect(lines).toContain("now: local:gemma4:31b  fix  repeat 2");
  });

  it("says it is waiting when nothing is in flight", () => {
    expect(screen(viewOf([{ type: "plan", plan }])).join("\n")).toContain(
      "waiting for the next run",
    );
  });
});

describe("the model table", () => {
  it("shows green over executed rather than over attempted", () => {
    const view = viewOf([
      { type: "plan", plan },
      outcome(),
      outcome({ gatePassed: false }),
      outcome({ executed: false, abstentionReason: "no-content" }),
    ]);

    expect(screen(view).join("\n")).toContain("3 run(s)  1/2 green");
  });

  it("names the abstentions beside the count, so an unmeasured run is never silent", () => {
    const view = viewOf([
      { type: "plan", plan },
      outcome({ executed: false, abstentionReason: "no-content" }),
    ]);

    expect(screen(view).join("\n")).toContain("(1 no-content)");
  });

  it("keeps the models in plan order as the table fills", () => {
    const view = viewOf([{ type: "plan", plan }, outcome({ model: "local:gemma4:31b" })]);
    const lines = screen(view);

    const first = lines.findIndex((line) => line.includes("local:qwen3.6:35b-a3b"));
    const second = lines.findIndex((line) => line.includes("local:gemma4:31b  "));
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(second);
  });

  it("drops the run count and the abstentions on a narrow terminal, never the score", () => {
    const view = viewOf([
      { type: "plan", plan },
      outcome({ executed: false, abstentionReason: "no-content" }),
    ]);
    const lines = screen(view, { columns: 60 }).join("\n");

    expect(lines).toContain("0/0 green");
    expect(lines).not.toContain("no-content");
  });
});

describe("the recent list", () => {
  it("says what each finished run did", () => {
    const view = viewOf([
      { type: "plan", plan },
      outcome({ caseId: "one" }),
      outcome({ caseId: "two", gatePassed: false }),
      outcome({ caseId: "three", executed: false, abstentionReason: "output-cap-without-content" }),
    ]);
    const lines = screen(view).join("\n");

    expect(lines).toContain("one #1  green");
    expect(lines).toContain("two #1  red");
    expect(lines).toContain("three #1  not measured: output-cap-without-content");
  });

  it("comes off entirely on a narrow terminal", () => {
    const view = viewOf([{ type: "plan", plan }, outcome({ caseId: "one" })]);

    expect(screen(view, { columns: 60 }).join("\n")).not.toContain("recent");
  });
});

describe("the shape of every row", () => {
  const view = viewOf([
    { type: "plan", plan },
    { type: "run-started", current: { model: "local:gemma4:31b", caseId: "fix", repeat: 2 } },
    outcome(),
    outcome({ executed: false, abstentionReason: "no-content" }),
  ]);

  for (const columns of [40, 60, 80, 120, 200]) {
    it(`never exceeds ${columns} columns`, () => {
      for (const line of screen(view, { columns })) {
        expect(displayWidth(line)).toBeLessThanOrEqual(columns);
      }
    });
  }

  for (const rows of [1, 2, 5, 12, 40]) {
    it(`fits in ${rows} row(s)`, () => {
      expect(screen(view, { rows }).length).toBeLessThanOrEqual(rows);
    });
  }

  it("renders with colour off, since a piped run is still a run", () => {
    const built = buildCalibrateScreen({
      view,
      columns: 100,
      rows: 40,
      theme: monochrome,
      elapsedMs: 1_000,
      bundleDirectory: "/tmp/bundle",
    });

    expect(built.every((row) => row.color === undefined)).toBe(true);
  });

  it("says where the evidence is going, which is what a person wants after three hours", () => {
    expect(screen(view).join("\n")).toContain("/tmp/bundle");
  });
});
