import { Box, Text, useInput, useStdout } from "ink";
import { createElement, type ReactElement, useEffect, useState } from "react";
import type { ConfirmationRequest } from "../tools/chokepoint.ts";
import type { ConfirmationQueue } from "./confirmation-queue.ts";
import type { EvidenceSummary } from "./evidence-panel.ts";
import type { KeyBindings } from "./key-bindings.ts";
import { dispatchKey, type KeyPress } from "./key-dispatcher.ts";
import { computeLayout, pageRows } from "./layout.ts";
import type { TranscriptLine } from "./screen-model.ts";
import { buildScreen, filterActions, type ScreenRow } from "./screen-model.ts";
import type { SessionStore } from "./session-store.ts";
import type { SessionView } from "./session-view.ts";
import type { Theme } from "./theme.ts";
import type { ViewAction, ViewState } from "./view-state.ts";

/**
 * One screen. Written with createElement rather than JSX so the CLI runs from source without
 * a build step, which is what makes `npm run dev` work.
 *
 * The component holds no layout, no truncation, and no decision about what a key does: it
 * subscribes, calls `buildScreen`, and maps each row to one `Text`. Everything worth testing
 * is in the pure functions beside it.
 */

interface SessionScreenProps {
  readonly store: SessionStore;
  readonly viewState: ViewState;
  readonly dispatch: (action: ViewAction) => void;
  readonly confirmations: ConfirmationQueue;
  readonly onOpen: (target: "review" | "bundle") => void;
  /** Called with the typed line when the prompt is submitted. Absent outside a session. */
  readonly onSubmitTask?: (task: string) => void;
  readonly theme: Theme;
  readonly bindings: KeyBindings;
  readonly task: string;
  readonly workspace: string;
  readonly evidence: EvidenceSummary | null;
  /** Turns already finished this session, so the screen does not forget between them. */
  readonly transcript?: readonly TranscriptLine[];
  /** How long the current activity has been going. A function, so each redraw reads it fresh. */
  readonly activityElapsedMs?: () => number;
}

/** Two rows kept back so the shell prompt and a wrapped line never push the top off screen. */
const rowsKeptBack = 2;

export function SessionScreen(props: SessionScreenProps): ReactElement {
  const [view, setView] = useState<SessionView>(props.store.getView());
  const [pending, setPending] = useState<ConfirmationRequest | null>(
    props.confirmations.current()?.request ?? null,
  );
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    columns: stdout?.columns ?? 80,
    rows: stdout?.rows ?? 24,
  });

  useEffect(() => props.store.subscribe(setView), [props.store]);
  useEffect(
    () => props.confirmations.subscribe((next) => setPending(next?.request ?? null)),
    [props.confirmations],
  );

  useEffect(() => {
    if (stdout === undefined) {
      return;
    }
    const onResize = (): void => {
      setSize({ columns: stdout.columns, rows: stdout.rows });
    };
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  // Pausing freezes what is drawn and nothing else: the store keeps applying events, and the
  // run never learns that anybody stopped looking.
  const [frozen, setFrozen] = useState<SessionView | null>(null);
  const paused = props.viewState.paused;
  useEffect(() => {
    setFrozen(paused ? props.store.getView() : null);
  }, [paused, props.store]);

  const rendered = frozen ?? view;
  const filtered = filterActions(rendered.actions, props.viewState.filter);
  const layout = computeLayout({
    columns: size.columns,
    rows: Math.max(4, size.rows - rowsKeptBack),
    planLines: rendered.plan.length === 0 ? 1 : rendered.plan.split("\n").length,
    gateCount: rendered.gates.length,
    expanded: props.viewState.expanded,
  });

  useInput((input, key) => {
    const press: KeyPress = { input, ctrl: key.ctrl, name: keyName(key, input) };
    const decision = dispatchKey(press, {
      bindings: props.bindings,
      state: props.viewState,
      confirmationPending: pending !== null,
      rowCount: props.viewState.focus === "gates" ? rendered.gates.length : filtered.length,
      pageRows: pageRows(layout),
    });

    if (decision.kind === "view") {
      props.dispatch(decision.action);
      return;
    }
    if (decision.kind === "answer-confirmation") {
      props.confirmations.current()?.answer(decision.approved);
      return;
    }
    if (decision.kind === "open") {
      props.onOpen(decision.target);
      return;
    }
    if (decision.kind === "submit-task") {
      // Read off the state rather than carried on the keypress: the dispatcher decides that
      // this was a submission, and what was typed is the view's to know.
      // Read off the state plus whatever arrived ahead of the newline in the same chunk,
      // rather than waiting for a dispatch to land: a state update is not synchronous.
      const typed = `${props.viewState.composing?.text ?? ""}${decision.typedFirst}`.trim();
      // An empty line is someone pressing enter at a prompt, which should leave the prompt
      // where it is rather than starting a turn with nothing in it.
      if (typed.length === 0) {
        return;
      }
      props.dispatch({ type: "compose-submitted" });
      props.onSubmitTask?.(typed);
    }
  });

  const rows = buildScreen({
    view: rendered,
    state: props.viewState,
    layout,
    theme: props.theme,
    bindings: props.bindings,
    task: props.task,
    workspace: props.workspace,
    confirmation: pending,
    evidence: props.evidence,
    ...(props.transcript === undefined ? {} : { transcript: props.transcript }),
    ...(props.activityElapsedMs === undefined
      ? {}
      : { activityElapsedMs: props.activityElapsedMs() }),
  });

  return createElement(
    Box,
    { flexDirection: "column" },
    ...rows.map((row, index) => createElement(Text, { key: index, ...textProps(row) }, row.text)),
    ...(props.viewState.openNotice === null
      ? []
      : [createElement(Text, { key: "open-notice", dimColor: true }, props.viewState.openNotice)]),
  );
}

function textProps(row: ScreenRow): {
  bold?: boolean;
  dimColor?: boolean;
  inverse?: boolean;
  color?: string;
} {
  return {
    ...(row.bold === true ? { bold: true } : {}),
    ...(row.dim === true ? { dimColor: true } : {}),
    ...(row.inverse === true ? { inverse: true } : {}),
    ...(row.color === undefined ? {} : { color: row.color }),
  };
}

interface InkKey {
  readonly upArrow: boolean;
  readonly downArrow: boolean;
  readonly leftArrow: boolean;
  readonly rightArrow: boolean;
  readonly pageDown: boolean;
  readonly pageUp: boolean;
  readonly return: boolean;
  readonly escape: boolean;
  readonly tab: boolean;
  readonly backspace: boolean;
  readonly delete: boolean;
}

/**
 * Ink's own classification, with the two control characters checked directly underneath it.
 *
 * A terminal sends carriage return for the enter key and some send line feed, and whether the
 * reader classifies either depends on the terminal and on raw mode. When it does not, the
 * character falls through to the printable branch and is typed into whatever is being composed,
 * which is how enter came to insert a character at the prompt instead of submitting the task.
 */
function keyName(key: InkKey, input = ""): KeyPress["name"] {
  if (input === "\r" || input === "\n") return "enter";
  if (key.upArrow) return "up";
  if (key.downArrow) return "down";
  if (key.leftArrow) return "left";
  if (key.rightArrow) return "right";
  if (key.pageUp) return "pageup";
  if (key.pageDown) return "pagedown";
  if (key.return) return "enter";
  if (key.escape) return "escape";
  if (key.tab) return "tab";
  if (key.backspace || key.delete) return "backspace";
  return null;
}
