/**
 * What the person watching has done to the view, kept apart from `SessionView`, which is the
 * projection of what the harness reported. Nothing here can reach a verdict: no field of this
 * type carries a gate status, a claim verdict, or a colour that means passed, so a keystroke
 * has no route to green (invariant 1). `view-state.test.ts` asserts that rather than trusting
 * the comment.
 */

export type Pane = "actions" | "gates";

/**
 * What is being typed at the prompt, and what has been typed before.
 *
 * A prompt is interactive state by the same argument as the filter box: it is what the person
 * is doing to the view, and none of it can reach a verdict. The typed text becomes a task only
 * when it is submitted, and it travels from here to the harness the way a task passed on argv
 * does. Nothing in `SessionView` reads it.
 */
export interface Composition {
  readonly text: string;
  /** Characters from the start, so left and right move without rebuilding the string. */
  readonly cursor: number;
  /** How far back the person has walked, or null while they are typing something new. */
  readonly recalled: number | null;
}

/** Where the run itself is, as far as the view is concerned. Set by the harness, not by keys. */
export type RunPhase = "running" | "finished";

export interface ViewState {
  readonly focus: Pane;
  /** Rows scrolled back from the newest. Zero follows the live tail. */
  readonly scrollBack: number;
  /** Index into the filtered rows of the focused pane, or null when the tail is following. */
  readonly selected: number | null;
  readonly expanded: boolean;
  /** Substring the action stream is narrowed to, empty for no filter. */
  readonly filter: string;
  /** True while the filter box is taking keystrokes, which suspends every letter binding. */
  readonly filtering: boolean;
  readonly helpOpen: boolean;
  /** True when the render is frozen. The run keeps going; only the screen stops updating. */
  readonly paused: boolean;
  /** Milliseconds since the interface started, from the injected clock. */
  readonly elapsedMs: number;
  readonly runPhase: RunPhase;
  /** True once the view has been left. The run continues and prints plain lines. */
  readonly detached: boolean;
  /** True once cancellation was asked for. The harness decides what that does. */
  readonly cancelRequested: boolean;
  /** True while the evidence panel is the screen. */
  readonly evidenceOpen: boolean;
  /** What the last open attempt did, shown in the panel so a silent failure is not silent. */
  readonly openNotice: string | null;
  /** The prompt, when the session is waiting for a task rather than running one. */
  readonly composing: Composition | null;
  /**
   * Tasks already submitted this session, newest last, so the prompt can offer them back.
   * Outside `composing` because it has to outlive the turn that typed it.
   */
  readonly taskHistory: readonly string[];
}

export const initialViewState: ViewState = {
  focus: "actions",
  scrollBack: 0,
  selected: null,
  expanded: false,
  filter: "",
  filtering: false,
  helpOpen: false,
  paused: false,
  elapsedMs: 0,
  runPhase: "running",
  detached: false,
  cancelRequested: false,
  evidenceOpen: false,
  openNotice: null,
  composing: null,
  taskHistory: [],
};

export type ViewAction =
  | { readonly type: "scroll"; readonly rows: number }
  | { readonly type: "scroll-to-tail" }
  | { readonly type: "scroll-to-oldest"; readonly rowCount: number }
  | { readonly type: "focus-pane"; readonly pane: Pane }
  | { readonly type: "cycle-focus" }
  | { readonly type: "toggle-expanded" }
  | { readonly type: "toggle-help" }
  | { readonly type: "toggle-pause" }
  | { readonly type: "start-filter" }
  | { readonly type: "filter-input"; readonly text: string }
  | { readonly type: "filter-backspace" }
  | { readonly type: "commit-filter" }
  | { readonly type: "clear-filter" }
  | { readonly type: "detach" }
  | { readonly type: "cancel-run" }
  | { readonly type: "open-evidence" }
  | { readonly type: "close-evidence" }
  | { readonly type: "note-open"; readonly notice: string }
  | { readonly type: "tick"; readonly elapsedMs: number }
  | { readonly type: "run-finished" }
  | { readonly type: "escape" }
  | { readonly type: "compose-start" }
  | { readonly type: "compose-input"; readonly text: string }
  | { readonly type: "compose-backspace" }
  | { readonly type: "compose-delete-word" }
  | { readonly type: "compose-move"; readonly by: number }
  | { readonly type: "compose-recall"; readonly by: number }
  | { readonly type: "compose-submitted" };

/** The reducer. Pure, total, and the only way `ViewState` changes. */
export function applyViewAction(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case "scroll": {
      const scrollBack = Math.max(0, state.scrollBack + action.rows);
      return { ...state, scrollBack, selected: scrollBack === 0 ? null : scrollBack - 1 };
    }
    case "scroll-to-tail":
      return { ...state, scrollBack: 0, selected: null, expanded: false };
    case "scroll-to-oldest": {
      const scrollBack = Math.max(0, action.rowCount);
      return { ...state, scrollBack, selected: scrollBack === 0 ? null : scrollBack - 1 };
    }
    case "focus-pane":
      return { ...state, focus: action.pane, expanded: false };
    case "cycle-focus":
      return { ...state, focus: state.focus === "actions" ? "gates" : "actions", expanded: false };
    case "toggle-expanded":
      return { ...state, expanded: !state.expanded };
    case "toggle-help":
      return { ...state, helpOpen: !state.helpOpen };
    case "toggle-pause":
      return { ...state, paused: !state.paused };
    case "start-filter":
      return { ...state, filtering: true, focus: "actions" };
    case "filter-input":
      return { ...state, filter: state.filter + action.text };
    case "filter-backspace":
      return { ...state, filter: state.filter.slice(0, -1) };
    case "commit-filter":
      return { ...state, filtering: false, scrollBack: 0, selected: null };
    case "clear-filter":
      return { ...state, filtering: false, filter: "", scrollBack: 0, selected: null };
    case "detach":
      return { ...state, detached: true };
    case "cancel-run":
      // A second one is a person asking again because the first did not visibly do anything,
      // which happens while the panel is up after the run has already been told to stop.
      return state.cancelRequested
        ? { ...state, detached: true }
        : { ...state, cancelRequested: true };
    case "open-evidence":
      return { ...state, evidenceOpen: true, helpOpen: false, filtering: false };
    case "close-evidence":
      return { ...state, evidenceOpen: false, openNotice: null };
    case "note-open":
      return { ...state, openNotice: action.notice };
    case "tick":
      return { ...state, elapsedMs: action.elapsedMs };
    case "run-finished":
      return { ...state, runPhase: "finished" };
    case "compose-start":
      return {
        ...state,
        composing: { text: "", cursor: 0, recalled: null },
        runPhase: "finished",
        filtering: false,
        helpOpen: false,
        evidenceOpen: false,
      };
    case "compose-input": {
      if (state.composing === null) {
        return state;
      }
      const { text, cursor } = state.composing;
      return {
        ...state,
        composing: {
          ...state.composing,
          text: text.slice(0, cursor) + action.text + text.slice(cursor),
          cursor: cursor + action.text.length,
          recalled: null,
        },
      };
    }
    case "compose-backspace": {
      if (state.composing === null || state.composing.cursor === 0) {
        return state;
      }
      const { text, cursor } = state.composing;
      return {
        ...state,
        composing: {
          ...state.composing,
          text: text.slice(0, cursor - 1) + text.slice(cursor),
          cursor: cursor - 1,
        },
      };
    }
    case "compose-delete-word": {
      if (state.composing === null || state.composing.cursor === 0) {
        return state;
      }
      const { text, cursor } = state.composing;
      const before = text.slice(0, cursor);
      // Trailing spaces go with the word, so one press after a word always removes a word.
      const kept = before.replace(/\s*\S*$/, "");
      return {
        ...state,
        composing: { ...state.composing, text: kept + text.slice(cursor), cursor: kept.length },
      };
    }
    case "compose-move": {
      if (state.composing === null) {
        return state;
      }
      const cursor = Math.max(
        0,
        Math.min(state.composing.text.length, state.composing.cursor + action.by),
      );
      return { ...state, composing: { ...state.composing, cursor } };
    }
    case "compose-recall": {
      if (state.composing === null || state.taskHistory.length === 0) {
        return state;
      }
      const history = state.taskHistory;
      const from = state.composing.recalled ?? history.length;
      const next = Math.max(0, Math.min(history.length, from + action.by));
      // Walking past the newest returns to the empty line rather than sticking on the last one.
      const text = next === history.length ? "" : (history[next] ?? "");
      return {
        ...state,
        composing: {
          ...state.composing,
          text,
          cursor: text.length,
          recalled: next === history.length ? null : next,
        },
      };
    }
    case "compose-submitted": {
      if (state.composing === null) {
        return state;
      }
      const typed = state.composing.text.trim();
      return {
        ...state,
        composing: null,
        // An empty line is not a task and is not worth offering back, so only real ones are kept.
        taskHistory: typed.length === 0 ? state.taskHistory : [...state.taskHistory, typed],
        runPhase: "running",
        scrollBack: 0,
        selected: null,
        expanded: false,
      };
    }
    case "escape": {
      if (state.helpOpen) {
        return { ...state, helpOpen: false };
      }
      if (state.filtering) {
        return { ...state, filtering: false, filter: "", scrollBack: 0, selected: null };
      }
      if (state.expanded) {
        return { ...state, expanded: false };
      }
      return { ...state, scrollBack: 0, selected: null };
    }
  }
}
