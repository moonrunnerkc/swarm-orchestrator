import { describe, expect, it } from "vitest";
import { applyLoopEvent, emptySessionView } from "./session-view.ts";
import { applyViewAction, initialViewState, type ViewAction } from "./view-state.ts";

const everyAction: readonly ViewAction[] = [
  { type: "scroll", rows: -3 },
  { type: "scroll", rows: 7 },
  { type: "scroll-to-tail" },
  { type: "scroll-to-oldest", rowCount: 40 },
  { type: "focus-pane", pane: "gates" },
  { type: "cycle-focus" },
  { type: "toggle-expanded" },
  { type: "toggle-help" },
  { type: "toggle-pause" },
  { type: "start-filter" },
  { type: "filter-input", text: "shell" },
  { type: "filter-backspace" },
  { type: "commit-filter" },
  { type: "clear-filter" },
  { type: "detach" },
  { type: "cancel-run" },
  { type: "open-evidence" },
  { type: "close-evidence" },
  { type: "note-open", notice: "open exited 0" },
  { type: "tick", elapsedMs: 12_000 },
  { type: "run-finished" },
  { type: "escape" },
];

describe("what a keystroke can and cannot reach", () => {
  /**
   * Invariant 1 as a test rather than a comment. `SessionView` is the projection of what the
   * harness reported and is the only thing a verdict is read off; `ViewState` is what the
   * person watching has done. No action of the second can produce a field of the first, and
   * the two types share no field name that could let one be mistaken for the other.
   */
  it("cannot produce a gate, a claim, or a status from any action", () => {
    const projected = applyLoopEvent(emptySessionView, {
      type: "gate",
      gateId: "tests",
      status: "passed",
      blocking: true,
      detail: "all green",
      record: "sha256:a",
    });

    const verdictFields = Object.keys(projected);
    for (const action of everyAction) {
      const state = applyViewAction(initialViewState, action);
      for (const field of Object.keys(state)) {
        expect(verdictFields).not.toContain(field);
      }
    }
  });

  it("holds no field whose value could be read as a verdict", () => {
    const values = everyAction
      .map((action) => applyViewAction(initialViewState, action))
      .flatMap((state) => Object.values(state))
      .filter((value) => typeof value === "string");

    for (const value of values) {
      expect(value).not.toMatch(/passed|failed|verified|green/i);
    }
  });
});

describe("the view-state reducer", () => {
  it("follows the tail at a scroll of zero and never scrolls past it", () => {
    const scrolled = applyViewAction(initialViewState, { type: "scroll", rows: 5 });
    expect(scrolled.scrollBack).toBe(5);
    expect(applyViewAction(scrolled, { type: "scroll", rows: -99 }).scrollBack).toBe(0);
  });

  it("returns to following the newest row and drops the expansion with it", () => {
    const state = applyViewAction(applyViewAction(initialViewState, { type: "scroll", rows: 3 }), {
      type: "toggle-expanded",
    });
    const tail = applyViewAction(state, { type: "scroll-to-tail" });

    expect(tail.scrollBack).toBe(0);
    expect(tail.expanded).toBe(false);
  });

  it("types into the filter and takes a character back off it", () => {
    const typed = ["s", "h", "e"].reduce(
      (state, text) => applyViewAction(state, { type: "filter-input", text }),
      applyViewAction(initialViewState, { type: "start-filter" }),
    );

    expect(typed.filter).toBe("she");
    expect(applyViewAction(typed, { type: "filter-backspace" }).filter).toBe("sh");
  });

  it("keeps the filter when it is committed and drops it when it is cleared", () => {
    const typed = applyViewAction(applyViewAction(initialViewState, { type: "start-filter" }), {
      type: "filter-input",
      text: "shell",
    });

    expect(applyViewAction(typed, { type: "commit-filter" })).toMatchObject({
      filter: "shell",
      filtering: false,
    });
    expect(applyViewAction(typed, { type: "clear-filter" })).toMatchObject({
      filter: "",
      filtering: false,
    });
  });

  it("peels one layer at a time on escape", () => {
    let state = applyViewAction(initialViewState, { type: "scroll", rows: 4 });
    state = applyViewAction(state, { type: "toggle-expanded" });
    state = applyViewAction(state, { type: "start-filter" });
    state = applyViewAction(state, { type: "toggle-help" });

    state = applyViewAction(state, { type: "escape" });
    expect(state.helpOpen).toBe(false);
    state = applyViewAction(state, { type: "escape" });
    expect(state.filtering).toBe(false);
    state = applyViewAction(state, { type: "escape" });
    expect(state.expanded).toBe(false);
    state = applyViewAction(state, { type: "escape" });
    expect(state.scrollBack).toBe(0);
  });

  it("keeps detaching and cancelling apart, because conflating them loses work", () => {
    const detached = applyViewAction(initialViewState, { type: "detach" });
    expect(detached.detached).toBe(true);
    expect(detached.cancelRequested).toBe(false);

    const cancelled = applyViewAction(initialViewState, { type: "cancel-run" });
    expect(cancelled.cancelRequested).toBe(true);
    expect(cancelled.detached).toBe(false);
  });

  it("takes a second cancel as leave me alone, so the panel cannot trap anyone", () => {
    const once = applyViewAction(initialViewState, { type: "cancel-run" });
    const twice = applyViewAction(once, { type: "cancel-run" });

    expect(once.detached).toBe(false);
    expect(twice.detached).toBe(true);
  });

  it("pausing changes what is drawn and nothing about the run", () => {
    const paused = applyViewAction(initialViewState, { type: "toggle-pause" });
    expect(paused.paused).toBe(true);
    expect(paused.cancelRequested).toBe(false);
    expect(paused.detached).toBe(false);
  });
});
