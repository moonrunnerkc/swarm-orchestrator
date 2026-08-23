import { describe, expect, it } from "vitest";
import {
  EmptyKeyBindingError,
  keyActionNames,
  resolveKeyBindings,
  UnknownKeyActionError,
} from "./key-bindings.ts";
import { type Dispatch, dispatchKey, type KeyPress, keyToken } from "./key-dispatcher.ts";
import { applyViewAction, initialViewState, type ViewState } from "./view-state.ts";

const bindings = resolveKeyBindings();

function press(input: string, extra: Partial<KeyPress> = {}): KeyPress {
  return { input, ctrl: false, name: null, ...extra };
}

function decide(key: KeyPress, state: ViewState = initialViewState, pending = false): Dispatch {
  return dispatchKey(key, {
    bindings,
    state,
    confirmationPending: pending,
    rowCount: 40,
    pageRows: 10,
  });
}

describe("every default binding", () => {
  const table: readonly (readonly [KeyPress, Dispatch])[] = [
    [press("j"), { kind: "view", action: { type: "scroll", rows: -1 } }],
    [press("", { name: "down" }), { kind: "view", action: { type: "scroll", rows: -1 } }],
    [press("k"), { kind: "view", action: { type: "scroll", rows: 1 } }],
    [press("", { name: "up" }), { kind: "view", action: { type: "scroll", rows: 1 } }],
    [press("d", { ctrl: true }), { kind: "view", action: { type: "scroll", rows: -10 } }],
    [press("u", { ctrl: true }), { kind: "view", action: { type: "scroll", rows: 10 } }],
    [press("", { name: "pagedown" }), { kind: "view", action: { type: "scroll", rows: -10 } }],
    [press("", { name: "pageup" }), { kind: "view", action: { type: "scroll", rows: 10 } }],
    [press("g"), { kind: "view", action: { type: "scroll-to-oldest", rowCount: 40 } }],
    [press("G"), { kind: "view", action: { type: "scroll-to-tail" } }],
    [press("", { name: "enter" }), { kind: "view", action: { type: "toggle-expanded" } }],
    [press("", { name: "tab" }), { kind: "view", action: { type: "cycle-focus" } }],
    [press("/"), { kind: "view", action: { type: "start-filter" } }],
    [press("p"), { kind: "view", action: { type: "toggle-pause" } }],
    [press("?"), { kind: "view", action: { type: "toggle-help" } }],
    [press("e"), { kind: "view", action: { type: "open-evidence" } }],
    [press("q"), { kind: "view", action: { type: "detach" } }],
    [press("c", { ctrl: true }), { kind: "view", action: { type: "cancel-run" } }],
    [press("", { name: "escape" }), { kind: "view", action: { type: "escape" } }],
  ];

  for (const [key, expected] of table) {
    it(`maps ${keyToken(key)}`, () => {
      expect(decide(key)).toEqual(expected);
    });
  }

  it("ignores a key nothing is bound to", () => {
    expect(decide(press("z"))).toEqual({ kind: "ignored" });
  });
});

describe("the keys that must not fire mid-run", () => {
  it("will not open a review page before a bundle exists", () => {
    expect(decide(press("o"))).toEqual({ kind: "ignored" });
    expect(decide(press("b"))).toEqual({ kind: "ignored" });
  });

  it("will not answer a confirmation nobody asked for", () => {
    expect(decide(press("y"))).toEqual({ kind: "ignored" });
    expect(decide(press("n"))).toEqual({ kind: "ignored" });
  });

  it("takes the keyboard while a confirmation is waiting", () => {
    expect(decide(press("y"), initialViewState, true)).toEqual({
      kind: "answer-confirmation",
      approved: true,
    });
    expect(decide(press("n"), initialViewState, true)).toEqual({
      kind: "answer-confirmation",
      approved: false,
    });
    expect(decide(press("", { name: "escape" }), initialViewState, true)).toEqual({
      kind: "answer-confirmation",
      approved: false,
    });
    // Scrolling away from the question is not an answer, so the key does nothing.
    expect(decide(press("j"), initialViewState, true)).toEqual({ kind: "ignored" });
  });

  it("lets cancel through from every mode, since it is the key for a screen gone wrong", () => {
    const cancel = press("c", { ctrl: true });
    const modes: readonly ViewState[] = [
      initialViewState,
      applyViewAction(initialViewState, { type: "start-filter" }),
      applyViewAction(initialViewState, { type: "toggle-help" }),
      applyViewAction(initialViewState, { type: "open-evidence" }),
    ];

    for (const state of modes) {
      expect(decide(cancel, state)).toEqual({ kind: "view", action: { type: "cancel-run" } });
    }
    expect(decide(cancel, initialViewState, true)).toEqual({
      kind: "view",
      action: { type: "cancel-run" },
    });
  });
});

describe("filtering takes the letters", () => {
  const filtering = applyViewAction(initialViewState, { type: "start-filter" });

  it("types a letter that is otherwise a binding", () => {
    expect(decide(press("p"), filtering)).toEqual({
      kind: "view",
      action: { type: "filter-input", text: "p" },
    });
    expect(decide(press("q"), filtering)).toEqual({
      kind: "view",
      action: { type: "filter-input", text: "q" },
    });
  });

  it("applies on enter and clears on escape", () => {
    expect(decide(press("", { name: "enter" }), filtering)).toEqual({
      kind: "view",
      action: { type: "commit-filter" },
    });
    expect(decide(press("", { name: "escape" }), filtering)).toEqual({
      kind: "view",
      action: { type: "clear-filter" },
    });
  });

  it("takes a character back on backspace", () => {
    expect(decide(press("", { name: "backspace" }), filtering)).toEqual({
      kind: "view",
      action: { type: "filter-backspace" },
    });
  });
});

describe("the evidence panel", () => {
  const open = applyViewAction(initialViewState, { type: "open-evidence" });

  it("opens each artifact under its own key", () => {
    expect(decide(press("o"), open)).toEqual({ kind: "open", target: "review" });
    expect(decide(press("b"), open)).toEqual({ kind: "open", target: "bundle" });
  });

  it("closes on the key that opened it and on escape", () => {
    expect(decide(press("e"), open)).toEqual({
      kind: "view",
      action: { type: "close-evidence" },
    });
    expect(decide(press("", { name: "escape" }), open)).toEqual({
      kind: "view",
      action: { type: "close-evidence" },
    });
  });

  it("does not scroll the stream that is no longer on screen", () => {
    expect(decide(press("j"), open)).toEqual({ kind: "ignored" });
  });
});

describe("the help overlay", () => {
  const open = applyViewAction(initialViewState, { type: "toggle-help" });

  it("closes on either key and swallows everything else", () => {
    expect(decide(press("?"), open)).toEqual({ kind: "view", action: { type: "toggle-help" } });
    expect(decide(press("", { name: "escape" }), open)).toEqual({
      kind: "view",
      action: { type: "toggle-help" },
    });
    expect(decide(press("j"), open)).toEqual({ kind: "ignored" });
  });
});

describe("rebinding from config", () => {
  it("moves an action to the key named and leaves the old key doing nothing", () => {
    const rebound = resolveKeyBindings({ pause: " ", detach: "x" });
    const context = {
      bindings: rebound,
      state: initialViewState,
      confirmationPending: false,
      rowCount: 5,
      pageRows: 3,
    };

    expect(dispatchKey(press(" "), context)).toEqual({
      kind: "view",
      action: { type: "toggle-pause" },
    });
    expect(dispatchKey(press("x"), context)).toEqual({ kind: "view", action: { type: "detach" } });
    expect(dispatchKey(press("p"), context)).toEqual({ kind: "ignored" });
    expect(dispatchKey(press("q"), context)).toEqual({ kind: "ignored" });
  });

  it("shows the rebound key in the label the hint bar reads", () => {
    expect(resolveKeyBindings({ pause: "F" }).labelOf.get("pause")).toBe("F");
  });

  it("reads a modifier the way a person writes it", () => {
    const rebound = resolveKeyBindings({ "jump-newest": "Ctrl+E" });
    expect(rebound.byToken.get("ctrl+e")).toBe("jump-newest");
  });

  it("names the key and the accepted set when the action does not exist", () => {
    expect(() => resolveKeyBindings({ scrollDown: "j" })).toThrow(UnknownKeyActionError);
    expect(() => resolveKeyBindings({ scrollDown: "j" })).toThrow(/scroll-down/);
  });

  it("refuses an action bound to nothing", () => {
    expect(() => resolveKeyBindings({ pause: "" })).toThrow(EmptyKeyBindingError);
  });

  it("binds the space bar, written either way", () => {
    expect(resolveKeyBindings({ pause: " " }).byToken.get(" ")).toBe("pause");
    expect(resolveKeyBindings({ pause: "space" }).byToken.get(" ")).toBe("pause");
  });

  it("binds every action it names", () => {
    const resolved = resolveKeyBindings();
    for (const action of keyActionNames) {
      expect(resolved.labelOf.get(action)).toBeDefined();
    }
  });
});
