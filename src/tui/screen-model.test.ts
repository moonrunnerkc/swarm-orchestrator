import { describe, expect, it } from "vitest";
import type { LoopEvent } from "../core/loop-events.ts";
import type { EvidenceSummary } from "./evidence-panel.ts";
import { resolveKeyBindings } from "./key-bindings.ts";
import { computeLayout } from "./layout.ts";
import { evidenceLocation } from "./open-path.ts";
import { buildScreen, type ScreenInput, type ScreenRow, spinnerAt } from "./screen-model.ts";
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

  it("says it is waiting on the person while the chokepoint holds the run", () => {
    // What a stale activity row cost: a run sat on this question overnight and the line above
    // it still read "thinking, step 2" with a counter climbing past twelve hours. The screen
    // has to name the thing the run is actually blocked on, which is the person reading it.
    const view = (
      [
        { type: "model-call", step: 2, modelId: "local:m" },
        { type: "tool-call", callId: "a", toolName: "shell", input: { command: "python3 -V" } },
      ] satisfies readonly LoopEvent[]
    ).reduce(applyLoopEvent, emptySessionView);

    const line = screen(
      {
        view,
        activityElapsedMs: 45_071_000,
        confirmation: {
          toolName: "shell",
          detail: "python3 -V",
          reason: "shell-allowlist",
          explanation: '"python3 -V" is not on the shell allowlist.',
        },
      },
      { columns: 120, rows: 30 },
    )
      .map((row) => row.text)
      .find((text) => /^[\u2800-\u28ff] /.test(text));

    expect(line).toBeDefined();
    expect(line).toContain("waiting for you");
    expect(line).not.toContain("thinking");
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

describe("what the screen says a run came to", () => {
  /**
   * The defect this covers, reported by a person who ran it: the model answered `Not Found`
   * three times, the loop stopped at step 0 with `model-error`, nothing was written to the
   * workspace, and the screen said `DONE gate diff-budget: passed` in the accent colour. The
   * gates run after the loop and every gate event rewrites `status`, so the last gate to pass
   * over an empty diff became the last word on a run that built nothing.
   */
  it("leads with the stop reason when the loop did not complete", () => {
    const failed = [
      { type: "model-call", step: 1, modelId: "local:gemma4:31b" },
      { type: "stopped", reason: "model-error", steps: 0, tokensUsed: 0 },
      {
        type: "gate",
        gateId: "diff-budget",
        status: "passed",
        blocking: false,
        detail: "within budget: 0 file(s) and 0 added line(s)",
        record: "sha256:1111111122222222333333334444444455555555666666667777777788888888",
      },
    ] satisfies readonly LoopEvent[];
    const view = failed.reduce(applyLoopEvent, emptySessionView);

    const rows = screen({ view });
    const status = rows.map((row) => row.text).find((text) => text.includes("model-error"));

    expect(status).toBeDefined();
    expect(status).toContain("STOPPED");
    expect(rows.map((row) => row.text).some((text) => text.startsWith("DONE "))).toBe(false);
  });

  it("still says DONE when the loop actually completed", () => {
    const finished = [
      { type: "stopped", reason: "completed", steps: 4, tokensUsed: 812 },
      {
        type: "gate",
        gateId: "tests",
        status: "passed",
        blocking: true,
        detail: "4 collected, 4 passed",
        record: "sha256:1111111122222222333333334444444455555555666666667777777788888888",
      },
    ] satisfies readonly LoopEvent[];
    const view = finished.reduce(applyLoopEvent, emptySessionView);

    expect(
      screen({ view })
        .map((row) => row.text)
        .some((text) => text.startsWith("DONE ")),
    ).toBe(true);
  });
});

describe("a session that remembers the turns before this one", () => {
  /**
   * A screen that cleared itself between turns would be a screen that forgets, which is the
   * opposite of what a person holds a session open for. The task and what the gates decided
   * stay above the live stream.
   */
  it("keeps each finished turn above the current one", () => {
    const rows = screen({
      transcript: [
        { text: "create calculator.js", kind: "task" },
        { text: "6 gate(s) passed, 4 step(s)", kind: "outcome" },
      ],
    });
    const text = rows.map((row) => row.text);

    expect(text.some((line) => line.includes("create calculator.js"))).toBe(true);
    expect(text.some((line) => line.includes("6 gate(s) passed"))).toBe(true);
  });

  it("shows nothing extra when the session has no finished turn yet", () => {
    const withNone = screen({ transcript: [] }).map((row) => row.text);
    const withNoField = screen({}).map((row) => row.text);

    expect(withNone).toEqual(withNoField);
  });
});

describe("the prompt", () => {
  it("draws what is typed, with the cursor where the next character lands", () => {
    const composing = applyViewAction(
      applyViewAction(initialViewState, { type: "compose-start" }),
      { type: "compose-input", text: "fix the parser" },
    );

    const prompt = screen({ state: composing })
      .map((row) => row.text)
      .find((line) => line.startsWith("›"));

    expect(prompt).toContain("fix the parser");
    expect(prompt).toContain("█");
  });

  it("is absent while a turn is running, since there is nothing to type into", () => {
    expect(
      screen({})
        .map((row) => row.text)
        .some((line) => line.startsWith("›")),
    ).toBe(false);
  });
});

describe("a run that finished having touched nothing", () => {
  /**
   * The same defect as the stop-reason one, wearing a different hat. Here the loop stops for
   * the honest reason `completed` having done nothing, which is what a model answering in prose
   * looks like from the harness's side, and every gate then passes over an empty diff.
   */
  it("says so rather than showing DONE over an empty diff", () => {
    const events = [
      { type: "stopped", reason: "completed", steps: 1, tokensUsed: 400 },
      { type: "changes", changedFiles: 0 },
      {
        type: "gate",
        gateId: "diff-budget",
        status: "passed",
        blocking: false,
        detail: "within budget: 0 file(s) and 0 added line(s)",
        record: "sha256:1111111122222222333333334444444455555555666666667777777788888888",
      },
    ] satisfies readonly LoopEvent[];
    const view = events.reduce(applyLoopEvent, emptySessionView);

    const text = screen({ view }).map((row) => row.text);

    expect(text.some((line) => line.includes("no files changed"))).toBe(true);
    expect(text.some((line) => line.startsWith("DONE "))).toBe(false);
  });

  it("shows an ordinary DONE when the run did change something", () => {
    const events = [
      { type: "stopped", reason: "completed", steps: 4, tokensUsed: 900 },
      { type: "changes", changedFiles: 2 },
    ] satisfies readonly LoopEvent[];
    const view = events.reduce(applyLoopEvent, emptySessionView);

    expect(
      screen({ view })
        .map((row) => row.text)
        .some((line) => line.startsWith("DONE ")),
    ).toBe(true);
  });
});

describe("showing that the run is alive, and what it is doing", () => {
  /**
   * There was nothing moving on this screen while a model thought or a shell command ran. The
   * status said "thinking (step 3)" and stayed there, and the one thing that changed was a
   * seconds counter the layout hides below 80 columns or 12 rows. A run that takes a minute was
   * indistinguishable from a run that had hung.
   */
  it("turns the spinner as time passes", () => {
    expect(spinnerAt(0)).not.toBe(spinnerAt(120));
    expect(spinnerAt(0)).toBe(spinnerAt(1200));
    expect(spinnerAt(-50)).toBe(spinnerAt(0));
  });

  it("names the tool that is running, and how long it has been", () => {
    const view = (
      [
        { type: "model-call", step: 1, modelId: "local:m" },
        { type: "tool-call", callId: "a", toolName: "shell", input: { command: "npm test" } },
        { type: "tool-started", toolName: "shell", detail: "npm test" },
      ] satisfies readonly LoopEvent[]
    ).reduce(applyLoopEvent, emptySessionView);

    // Found by the spinner rather than by the command, because the action stream also carries
    // a row mentioning it and that one comes first.
    const line = screen({ view, activityElapsedMs: 12_000 })
      .map((row) => row.text)
      .find((text) => text.startsWith(spinnerAt(0)) || /^[\u2800-\u28ff] /.test(text));

    expect(line).toBeDefined();
    expect(line).toContain("shell npm test");
    expect(line).toContain("12s");
  });

  it("shows what the model is saying while it says it", () => {
    const view = (
      [
        { type: "model-call", step: 1, modelId: "local:m" },
        { type: "model-text", step: 1, text: "I will read the failing test first" },
      ] satisfies readonly LoopEvent[]
    ).reduce(applyLoopEvent, emptySessionView);

    const line = screen({ view })
      .map((row) => row.text)
      .find((text) => /^[\u2800-\u28ff] /.test(text));

    expect(line).toContain("thinking, step 1");
    expect(line).toContain("I will read the failing test");
  });

  /** One line of it. The whole response lands in the stream and the ledger; three copies is noise. */
  it("keeps it to one line however much the model says", () => {
    const long = Array.from({ length: 80 }, (_, index) => `word${index}`).join(" ");
    const view = (
      [
        { type: "model-call", step: 1, modelId: "local:m" },
        { type: "model-text", step: 1, text: long },
      ] satisfies readonly LoopEvent[]
    ).reduce(applyLoopEvent, emptySessionView);

    const rows = screen({ view }, { columns: 100, rows: 30 });
    expect(rows.every((row) => displayWidth(row.text) <= 100)).toBe(true);
  });

  it("shows nothing once the run has finished", () => {
    const view = (
      [
        { type: "model-call", step: 1, modelId: "local:m" },
        { type: "tool-started", toolName: "shell", detail: "npm test" },
        { type: "stopped", reason: "completed", steps: 1, tokensUsed: 10 },
      ] satisfies readonly LoopEvent[]
    ).reduce(applyLoopEvent, emptySessionView);

    expect(
      screen({ view })
        .map((row) => row.text)
        .some((text) => /^[\u2800-\u28ff] /.test(text)),
    ).toBe(false);
  });
});
