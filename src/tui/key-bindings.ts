/**
 * The keymap as data. Bindings resolve once, at the composition root, from the defaults plus
 * whatever `[keys]` in swarm.toml overrode, and the dispatcher then reads a table rather than
 * a chain of conditionals.
 */

export type KeyAction =
  | "scroll-down"
  | "scroll-up"
  | "page-down"
  | "page-up"
  | "jump-oldest"
  | "jump-newest"
  | "expand"
  | "next-pane"
  | "filter"
  | "pause"
  | "help"
  | "evidence"
  | "open-review"
  | "open-bundle"
  | "detach"
  | "cancel"
  | "confirm-yes"
  | "confirm-no"
  | "back";

/** What each action does, in the words the help overlay and the hint bar both read from. */
export const keyActionDescriptions: Readonly<Record<KeyAction, string>> = {
  "scroll-down": "scroll down one row",
  "scroll-up": "scroll up one row",
  "page-down": "scroll down one page",
  "page-up": "scroll up one page",
  "jump-oldest": "jump to the oldest row",
  "jump-newest": "follow the newest row",
  expand: "expand or collapse the selected row",
  "next-pane": "move focus between the action stream and the gates",
  filter: "filter the action stream",
  pause: "freeze the screen, which does not touch the run",
  help: "this help",
  evidence: "show what this run produced",
  "open-review": "open the review page",
  "open-bundle": "open the bundle directory",
  detach: "leave the view, run keeps going",
  cancel: "cancel the run",
  "confirm-yes": "approve the call being asked about",
  "confirm-no": "refuse the call being asked about",
  back: "close the overlay, or clear the filter",
};

export const keyActionNames: readonly KeyAction[] = Object.keys(
  keyActionDescriptions,
) as KeyAction[];

/**
 * One key token per action for the hint bar to name, plus the aliases people reach for. The
 * first token listed is the one shown.
 */
const defaultBindings: Readonly<Record<KeyAction, readonly string[]>> = {
  "scroll-down": ["j", "down"],
  "scroll-up": ["k", "up"],
  "page-down": ["ctrl+d", "pagedown"],
  "page-up": ["ctrl+u", "pageup"],
  "jump-oldest": ["g"],
  "jump-newest": ["G"],
  expand: ["enter"],
  "next-pane": ["tab"],
  filter: ["/"],
  pause: ["p"],
  help: ["?"],
  evidence: ["e"],
  "open-review": ["o"],
  "open-bundle": ["b"],
  detach: ["q"],
  cancel: ["ctrl+c"],
  "confirm-yes": ["y"],
  "confirm-no": ["n"],
  back: ["escape"],
};

export class UnknownKeyActionError extends Error {
  constructor(name: string) {
    super(
      `[keys] ${name} is not an action this build binds. Accepted actions: ` +
        `${keyActionNames.join(", ")}.`,
    );
    this.name = "UnknownKeyActionError";
  }
}

export class EmptyKeyBindingError extends Error {
  constructor(action: string) {
    super(
      `[keys] ${action} was given an empty key. Name a key such as "p", "ctrl+d", "enter", ` +
        `"escape", "tab", "space", "up", "down", "pageup" or "pagedown".`,
    );
    this.name = "EmptyKeyBindingError";
  }
}

export interface KeyBindings {
  /** Key token to action. The dispatcher does one lookup in here per keystroke. */
  readonly byToken: ReadonlyMap<string, KeyAction>;
  /** Action to the token the help and hint bar show for it. */
  readonly labelOf: ReadonlyMap<KeyAction, string>;
}

/**
 * Defaults, with each overridden action rebound to exactly the key named: an override
 * replaces that action's keys rather than adding to them, so a rebinding cannot leave the old
 * key doing the old thing.
 */
export function resolveKeyBindings(overrides: Readonly<Record<string, string>> = {}): KeyBindings {
  for (const name of Object.keys(overrides)) {
    if (!keyActionNames.includes(name as KeyAction)) {
      throw new UnknownKeyActionError(name);
    }
    // Emptiness, not blankness: the space bar is a key somebody will want to bind, and
    // trimming it away would refuse the binding rather than make it.
    if ((overrides[name] ?? "").length === 0) {
      throw new EmptyKeyBindingError(name);
    }
  }

  const byToken = new Map<string, KeyAction>();
  const labelOf = new Map<KeyAction, string>();

  for (const action of keyActionNames) {
    const override = overrides[action];
    const tokens =
      override === undefined ? (defaultBindings[action] ?? []) : [normalizeToken(override)];
    for (const token of tokens) {
      byToken.set(token, action);
    }
    const label = tokens[0];
    if (label !== undefined) {
      labelOf.set(action, label);
    }
  }

  return { byToken, labelOf };
}

/**
 * Lowercased around the modifier, so "Ctrl+D" and "ctrl+d" are one binding. A single
 * character keeps its case, so "G" and "g" stay two keys, and the space bar can be written
 * either as itself or as the word, since a bare space in a TOML string is easy to miss.
 */
function normalizeToken(raw: string): string {
  if (raw.length === 1) {
    return raw;
  }
  const named = raw.trim().toLowerCase();
  return named === "space" ? " " : named;
}
