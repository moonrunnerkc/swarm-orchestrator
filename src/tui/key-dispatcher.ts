import type { KeyBindings } from "./key-bindings.ts";
import type { ViewAction, ViewState } from "./view-state.ts";

/**
 * One keystroke, normalized away from whatever the terminal sent. `name` is set for the keys
 * that have no printable form; otherwise `input` carries the character.
 */
export interface KeyPress {
  readonly input: string;
  readonly ctrl: boolean;
  readonly name:
    | "up"
    | "down"
    | "left"
    | "right"
    | "pageup"
    | "pagedown"
    | "enter"
    | "escape"
    | "tab"
    | "backspace"
    | null;
}

/** The token a keystroke is looked up under. Public so the tests can name keys the way a user does. */
export function keyToken(press: KeyPress): string {
  const base = press.name ?? press.input;
  return press.ctrl ? `ctrl+${base.toLowerCase()}` : base;
}

/**
 * What the dispatcher decided. Opening a file and answering a confirmation are not view
 * state, so they leave here as their own kinds rather than as something the reducer applies.
 */
export type Dispatch =
  | { readonly kind: "view"; readonly action: ViewAction }
  | { readonly kind: "answer-confirmation"; readonly approved: boolean }
  | { readonly kind: "open"; readonly target: "review" | "bundle" }
  | { readonly kind: "ignored" };

export interface DispatchContext {
  readonly bindings: KeyBindings;
  readonly state: ViewState;
  /** True while the chokepoint is waiting on an answer. It takes the keyboard while it waits. */
  readonly confirmationPending: boolean;
  /** Rows in the focused pane, so a page and a jump know how far they can go. */
  readonly rowCount: number;
  readonly pageRows: number;
}

const ignored: Dispatch = { kind: "ignored" };

/**
 * Pure: a keystroke and the current state in, one decision out. Every mode that takes the
 * keyboard away from the ordinary map is handled here rather than inside a component, which
 * is what makes "this key cannot fire right now" a table test rather than a manual check.
 */
export function dispatchKey(press: KeyPress, context: DispatchContext): Dispatch {
  const action = context.bindings.byToken.get(keyToken(press));

  // Cancelling outranks every mode: it is the key a person reaches for when the screen is
  // doing something they did not expect, and a mode that swallowed it would earn distrust.
  if (action === "cancel") {
    return { kind: "view", action: { type: "cancel-run" } };
  }

  if (context.confirmationPending) {
    if (action === "confirm-yes") {
      return { kind: "answer-confirmation", approved: true };
    }
    if (action === "confirm-no" || action === "back") {
      return { kind: "answer-confirmation", approved: false };
    }
    return ignored;
  }

  if (context.state.filtering) {
    return dispatchWhileFiltering(press, action);
  }

  if (context.state.evidenceOpen) {
    return dispatchInEvidencePanel(action);
  }

  if (context.state.helpOpen) {
    return action === "help" || action === "back"
      ? { kind: "view", action: { type: "toggle-help" } }
      : ignored;
  }

  return dispatchOnScreen(action, context);
}

function dispatchWhileFiltering(press: KeyPress, action: string | undefined): Dispatch {
  if (press.name === "enter") {
    return { kind: "view", action: { type: "commit-filter" } };
  }
  if (press.name === "escape") {
    return { kind: "view", action: { type: "clear-filter" } };
  }
  if (press.name === "backspace") {
    return { kind: "view", action: { type: "filter-backspace" } };
  }
  // Every printable key types rather than binding, or a filter could not contain a "p".
  if (press.name === null && !press.ctrl && press.input.length > 0) {
    return { kind: "view", action: { type: "filter-input", text: press.input } };
  }
  return action === "detach" ? { kind: "view", action: { type: "detach" } } : ignored;
}

function dispatchInEvidencePanel(action: string | undefined): Dispatch {
  switch (action) {
    case "open-review":
      return { kind: "open", target: "review" };
    case "open-bundle":
      return { kind: "open", target: "bundle" };
    case "evidence":
    case "back":
      return { kind: "view", action: { type: "close-evidence" } };
    case "detach":
      return { kind: "view", action: { type: "detach" } };
    case "help":
      return { kind: "view", action: { type: "toggle-help" } };
    default:
      return ignored;
  }
}

function dispatchOnScreen(action: string | undefined, context: DispatchContext): Dispatch {
  switch (action) {
    case "scroll-down":
      return { kind: "view", action: { type: "scroll", rows: -1 } };
    case "scroll-up":
      return { kind: "view", action: { type: "scroll", rows: 1 } };
    case "page-down":
      return { kind: "view", action: { type: "scroll", rows: -context.pageRows } };
    case "page-up":
      return { kind: "view", action: { type: "scroll", rows: context.pageRows } };
    case "jump-oldest":
      return { kind: "view", action: { type: "scroll-to-oldest", rowCount: context.rowCount } };
    case "jump-newest":
      return { kind: "view", action: { type: "scroll-to-tail" } };
    case "expand":
      return { kind: "view", action: { type: "toggle-expanded" } };
    case "next-pane":
      return { kind: "view", action: { type: "cycle-focus" } };
    case "filter":
      return { kind: "view", action: { type: "start-filter" } };
    case "pause":
      return { kind: "view", action: { type: "toggle-pause" } };
    case "help":
      return { kind: "view", action: { type: "toggle-help" } };
    case "evidence":
      return { kind: "view", action: { type: "open-evidence" } };
    case "detach":
      return { kind: "view", action: { type: "detach" } };
    case "back":
      return { kind: "view", action: { type: "escape" } };
    // The two openers exist only where a panel has said what they would open. Firing one
    // mid-run would launch a browser at a bundle that has not been written yet.
    case "open-review":
    case "open-bundle":
    case "confirm-yes":
    case "confirm-no":
      return ignored;
    default:
      return ignored;
  }
}
