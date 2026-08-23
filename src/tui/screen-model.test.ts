import { describe, expect, it } from "vitest";
import type { LoopEvent } from "../core/loop-events.ts";
import type { EvidenceSummary } from "./evidence-panel.ts";
import { resolveKeyBindings } from "./key-bindings.ts";
import { computeLayout } from "./layout.ts";
import { evidenceLocation } from "./open-path.ts";
import { buildScreen, type ScreenInput, type ScreenRow } from "./screen-model.ts";
import { applyLoopEvent, emptySessionView } from "./session-view.ts";
import { displayWidth } from "./terminal-text.ts";
import { resolveTheme } from "./theme.ts";
import { applyViewAction, initialViewState, type ViewAction } from "./view-state.ts";

const escapeCharacter = "\u001b";

const events: readonly LoopEvent[] = [
  { type: "plan", text: "read the failing test\nfix the parser\nrun the gates" },
  { type: "model-call", step: 1, modelId: "local:qwen3-coder:30b-a3b" },
  { type: "tool-call", callId: "a", toolName: "read", input: { path: "src/日本語/parse.ts" } },
  {
    type: "tool-outcome",
    callId: "a",
    toolName: "read",
    failed: false,
    output: "export function parse() {}",
  },
  { type: "tool-call", callId: "b", toolName: "shell", input: { command: "npm test" } },
  {
    type: "tool-outcome",
    callId: "b",
    toolName: "shell",
    failed: true,
    output: "1 failing\nAssertionError: expected 2 to be 3\nat parse.test.ts:12",
  },
  {
    type: "gate",
    gateId: "tests",
    status: "failed",
    blocking: true,
    detail: "12 collected, 1 failed",
    record: "sha256:aaaaaaaabbbbbbbbccccccccdddddddd",
  },
  {
    type: "gate",
    gateId: "lint",
    status: "passed",
    blocking: true,
    detail: "no findings",
    record: "sha256:eeee",
  },
  {
    type: "gate",
    gateId: "coverage",
    status: "not-applicable",
    blocking: true,
    detail: "no report was written",
    record: "sha256:ffff",
  },
  {
    type: "gate",
    gateId: "diff-budget",
    status: "failed",
    blocking: false,
    detail: "3 files over budget",
    record: "sha256:1111",
  },
];

const view = events.reduce(applyLoopEvent, emptySessionView);

const summary: EvidenceSummary = {
  location: evidenceLocation("/home/someone/.swarm/sessions/s-1/bundle", "harness"),
  recordCount: 42,
  claimsVerified: 3,
  claimsRefused: 11,
  verification: { kind: "verified", exitCode: 0 },
};

function screen(
  overrides: Partial<ScreenInput> = {},
  size = { columns: 100, rows: 30 },
  actions: readonly ViewAction[] = [],
): readonly ScreenRow[] {
  const state = actions.reduce(applyViewAction, initialViewState);
  return buildScreen({
    view,
    state,
    layout: computeLayout({
      columns: size.columns,
      rows: size.rows,
      planLines: 3,
      gateCount: view.gates.length,
      expanded: state.expanded,
    }),
    theme: resolveTheme({ mode: "always", term: "xterm", noColorSet: false, isTty: true }),
    bindings: resolveKeyBindings(),
    task: "make the parser handle an empty file",
    workspace: "/work/repo",
    confirmation: null,
    evidence: null,
    ...overrides,
  });
}

function text(rows: readonly ScreenRow[]): string {
  return rows.map((row) => row.text).join("\n");
}

describe("the screen at every width", () => {
  for (const columns of [60, 80, 120, 200]) {
    it(`writes no row wider than ${columns} cells`, () => {
      for (const rows of [8, 12, 24, 40]) {
        for (const actions of [[], [{ type: "toggle-expanded" } as ViewAction]]) {
          for (const row of screen({}, { columns, rows }, actions)) {
            expect(displayWidth(row.text)).toBeLessThanOrEqual(columns);
          }
        }
      }
    });
  }

  it("still names the task and the run's state at 60 columns", () => {
    const rendered = text(screen({}, { columns: 60, rows: 24 }));
    expect(rendered).toContain("swarm");
    expect(rendered).toContain("gate diff-budget");
  });

  it("shows the workspace and the model only where there is room for them", () => {
    expect(text(screen({}, { columns: 120, rows: 30 }))).toContain("/work/repo");
    expect(text(screen({}, { columns: 60, rows: 30 }))).not.toContain("/work/repo");
  });
});

describe("the screen at every height", () => {
  it("paints something legible at every height from one row up", () => {
    for (let rows = 1; rows <= 40; rows += 1) {
      const rendered = screen({}, { columns: 100, rows });
      expect(rendered.length).toBeGreaterThan(0);
      expect(rendered[0]?.text).toContain("swarm");
    }
  });

  it("keeps the status line as soon as there are two rows to put it on", () => {
    expect(text(screen({}, { columns: 100, rows: 2 }))).toContain(view.status);
  });
});

describe("what the gate strip says", () => {
  it("carries a word on every gate, so the strip reads without colour", () => {
    const rendered = text(screen({}, { columns: 120, rows: 30 }));
    expect(rendered).toContain("PASS lint");
    expect(rendered).toContain("FAIL tests");
    expect(rendered).toContain("N/A  coverage");
    expect(rendered).toContain("WARN diff-budget");
  });

  it("says advisory out loud rather than only in a colour", () => {
    expect(text(screen({}, { columns: 120, rows: 30 }))).toContain("diff-budget (advisory)");
  });

  it("shows a not-applicable gate as its own state and never as a pass", () => {
    const rendered = text(screen({}, { columns: 120, rows: 30 }));
    expect(rendered).toContain("N/A  coverage");
    expect(rendered).not.toContain("PASS coverage");
  });

  it("shows the record digest when a gate row is expanded, so the line can be looked up", () => {
    const rendered = text(
      screen({}, { columns: 120, rows: 40 }, [
        { type: "focus-pane", pane: "gates" },
        { type: "toggle-expanded" },
      ]),
    );
    expect(rendered).toContain("record sha256:");
  });
});

describe("with colour off", () => {
  const mono = resolveTheme({ mode: "never", term: "dumb", noColorSet: true, isTty: true });

  it("hands the renderer no colour on any row", () => {
    for (const row of screen({ theme: mono }, { columns: 100, rows: 30 })) {
      expect(row.color).toBeUndefined();
    }
  });

  it("writes no escape sequence into any row", () => {
    expect(text(screen({ theme: mono }, { columns: 100, rows: 30 }))).not.toContain(
      escapeCharacter,
    );
  });

  it("says the same things it says in colour", () => {
    const rendered = text(screen({ theme: mono }, { columns: 120, rows: 30 }));
    expect(rendered).toContain("PASS lint");
    expect(rendered).toContain("FAIL tests");
  });
});

describe("what a payload cannot do to the screen", () => {
  it("shows a cursor-control sequence in tool output rather than obeying it", () => {
    const hostile = applyLoopEvent(view, {
      type: "tool-outcome",
      callId: "c",
      toolName: "shell",
      failed: false,
      output: `${escapeCharacter}[2J${escapeCharacter}[1;1Hcleared your screen`,
    });

    const rendered = text(screen({ view: hostile }, { columns: 120, rows: 30 }));
    expect(rendered).not.toContain(escapeCharacter);
    expect(rendered).toContain("cleared your screen");
  });
});

describe("the honest counters", () => {
  it("shows elapsed, steps and the attempt, and never a percentage", () => {
    const withAttempt = applyLoopEvent(view, { type: "attempt", attempt: 2, cap: 3 });
    const rendered = text(
      screen({ view: withAttempt }, { columns: 140, rows: 30 }, [
        { type: "tick", elapsedMs: 92_000 },
      ]),
    );

    expect(rendered).toContain("1m 32s");
    expect(rendered).toContain("step 1");
    expect(rendered).toContain("attempt 2/3");
    expect(rendered).not.toMatch(/\d+%/);
  });

  it("says the token count is not in yet rather than showing a zero as a measurement", () => {
    expect(text(screen({}, { columns: 140, rows: 30 }))).toContain("tokens at the end");
  });
});

describe("filtering and expanding", () => {
  it("narrows the stream to the rows that match", () => {
    const rendered = text(
      screen({}, { columns: 120, rows: 30 }, [
        { type: "start-filter" },
        { type: "filter-input", text: "shell" },
        { type: "commit-filter" },
      ]),
    );

    expect(rendered).toContain("shell");
    expect(rendered).not.toContain("read path=");
  });

  it("shows more of a payload when the row is expanded than the summary held", () => {
    const collapsed = text(screen({}, { columns: 120, rows: 40 }));
    const expanded = text(screen({}, { columns: 120, rows: 40 }, [{ type: "toggle-expanded" }]));

    expect(collapsed).not.toContain("AssertionError");
    expect(expanded).toContain("AssertionError");
  });
});

describe("the overlays", () => {
  it("lists every key with what it does", () => {
    const rendered = text(screen({}, { columns: 120, rows: 40 }, [{ type: "toggle-help" }]));
    expect(rendered).toContain("cancel the run");
    expect(rendered).toContain("leave the view, run keeps going");
  });

  it("shows the confirmation, and what each answer means", () => {
    const rendered = text(
      screen(
        {
          confirmation: {
            toolName: "shell",
            detail: "bash ./deploy.sh",
            reason: "derivation-heuristic",
            explanation: "this command overlaps a file the model read a moment ago",
          },
        },
        { columns: 120, rows: 30 },
      ),
    );

    expect(rendered).toContain("the chokepoint is asking");
    expect(rendered).toContain("bash ./deploy.sh");
    expect(rendered).toContain("y to run it, n or escape to refuse");
  });

  it("lists the artifacts by what they are for, and both claim counts", () => {
    const rendered = text(
      screen({ evidence: summary }, { columns: 140, rows: 40 }, [{ type: "open-evidence" }]),
    );

    expect(rendered).toContain("the page a person reads");
    expect(rendered).toContain("the bundle a stranger verifies");
    expect(rendered).toContain("verified 3 claim(s) and refused 11");
  });
});
