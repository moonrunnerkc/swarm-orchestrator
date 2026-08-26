import { render } from "ink";
import { createElement } from "react";
import type { Clock } from "../core/clock.ts";
import type { LoopEvent } from "../core/loop-events.ts";
import type { ConfirmationPrompt, ConfirmationRequest } from "../tools/chokepoint.ts";
import { createConfirmationQueue } from "./confirmation-queue.ts";
import { describeEvidence, type EvidenceSummary } from "./evidence-panel.ts";
import type { KeyBindings } from "./key-bindings.ts";
import { type OpenTarget, openEvidenceTarget, type SpawnHandler } from "./open-path.ts";
import { describeLoopEvent } from "./plain-lines.ts";
import { drainRenderTimings } from "./render-timings.ts";
import { SessionScreen } from "./screen.ts";
import type { TranscriptLine } from "./screen-model.ts";
import { createSessionStore } from "./session-store.ts";
import type { SessionView } from "./session-view.ts";
import type { Theme } from "./theme.ts";
import {
  applyViewAction,
  initialViewState,
  type ViewAction,
  type ViewState,
} from "./view-state.ts";

export interface SessionInterface {
  emit(event: LoopEvent): void;
  /**
   * A line for the person rather than for the screen: the gate summary, the routing reward,
   * a signing notice, where the bundle went. On the plain path it is written straight out, in
   * order, exactly as before. On the interactive path it is held until the screen comes down,
   * because a raw write into a terminal Ink is drawing on lands in the middle of a frame.
   */
  note(line: string): void;
  /**
   * The chokepoint's prompt. On the interactive path it is a component inside the running
   * screen, answered by the same key dispatcher; on every other path it is what it was.
   */
  readonly confirm: ConfirmationPrompt;
  /** Resolves when the person asks to stop the run, and never otherwise. */
  cancelled(): Promise<void>;
  /** Shows what the run produced, and offers to open it. Returns when the panel is done with. */
  presentEvidence(summary: EvidenceSummary): Promise<void>;
  /**
   * Waits for the next task the person types, or null when they are done. Only a session calls
   * this; a run passed its task on argv and never asks.
   */
  readTask(): Promise<string | null>;
  /** Clears the last turn off the screen so the next one is not read as a continuation of it. */
  beginTurn(task: string): void;
  stop(): Promise<void>;
}

export interface SessionInterfaceOptions {
  readonly task: string;
  readonly workspace: string;
  readonly isTty: boolean;
  /** False forces the plain stream on a TTY, which is what `--no-tui` is for. */
  readonly interactive: boolean;
  readonly writeLine: (line: string) => void;
  readonly writeError: (line: string) => void;
  readonly clock: Clock;
  readonly theme: Theme;
  readonly bindings: KeyBindings;
  /** Reads a line off the terminal on the plain path. Absent where there is no terminal. */
  readonly askOnTerminal?: (question: string) => Promise<string>;
  /**
   * Reads the next task, or null at end of input. Separate from `askOnTerminal` because that
   * one asks a yes-or-no question and this one waits for work, and because this accepts a pipe
   * while a confirmation must not.
   */
  readonly readLine?: (prompt: string) => Promise<string | null>;
  readonly openEvidence: OpenEvidencePolicy;
  readonly spawnOpen: SpawnHandler;
  readonly platform: NodeJS.Platform;
}

/** What happens when a run finishes: ask, always open, or never open. Never opens off a TTY. */
export type OpenEvidencePolicy = "ask" | "always" | "never";

/**
 * How often the screen redraws. A second is what a person reads on a counter, and it is far too
 * slow for anything to look alive, so the rate follows what the run is doing: fast enough to
 * turn a spinner while something is happening, back to a second once nothing is.
 */
const workingTickMs = 120;
const idleTickMs = 1_000;

/**
 * Picks the interactive screen on a TTY and plain lines everywhere else, so piped output
 * stays readable and CI never renders cursor control codes. Every interactive feature is
 * TTY-only and degrades to the stream below.
 */
export function startSessionInterface(options: SessionInterfaceOptions): SessionInterface {
  return options.isTty && options.interactive
    ? interactiveInterface(options)
    : streamInterface(options);
}

/**
 * The plain path. Byte-identical to what it produced before the interactive work, which
 * `plain-lines.test.ts` holds to a committed fixture.
 */
function streamInterface(options: SessionInterfaceOptions): SessionInterface {
  return {
    emit(event: LoopEvent): void {
      const line = describeLoopEvent(event);
      if (line !== null) {
        options.writeLine(line);
      }
    },
    note: options.writeLine,
    confirm: (request) => confirmOnStream(request, options),
    cancelled: () => new Promise<void>(() => {}),
    async presentEvidence(summary: EvidenceSummary): Promise<void> {
      for (const line of describeEvidence(summary, null)) {
        options.writeLine(line);
      }
      if (options.openEvidence === "always") {
        const outcome = await openEvidenceTarget({
          location: summary.location,
          target: "review",
          platform: options.platform,
          env: {},
          spawn: options.spawnOpen,
        });
        options.writeLine(outcome.detail);
      }
    },
    async readTask(): Promise<string | null> {
      if (options.readLine === undefined) {
        // Nowhere to read a task from. A session with nobody to ask is over, and saying so
        // beats waiting on a stdin that will never carry one.
        return null;
      }
      // A pipe is a terminal's equal here, which is why this does not ask for a TTY: a file of
      // tasks fed in is a session someone wrote down in advance. Confirmation still refuses
      // without a terminal, because answering a security prompt is not the same as typing work.
      const line = await options.readLine("\u203a ");
      if (line === null) {
        return null;
      }
      const typed = line.trim();
      if (typed.length === 0) {
        return null;
      }
      return typed === "/exit" || typed === "/quit" ? null : typed;
    },
    beginTurn(task: string): void {
      options.writeLine(`\u203a ${task}`);
    },
    stop: () => Promise.resolve(),
  };
}

/**
 * Readline owns stdin here because Ink does not: this is the plain path, and on a terminal a
 * person can still answer. With no terminal the call is refused and recorded, which is what
 * the chokepoint does with a refusal either way.
 */
async function confirmOnStream(
  request: ConfirmationRequest,
  options: SessionInterfaceOptions,
): Promise<boolean> {
  if (!options.isTty || options.askOnTerminal === undefined) {
    options.writeError(
      `[chokepoint] refusing ${request.toolName} without a terminal to confirm on: ${request.explanation}`,
    );
    return false;
  }
  options.writeError(request.explanation);
  const answer = await options.askOnTerminal(`Run "${request.detail}"? [y/N] `);
  return answer.trim().toLowerCase() === "y";
}

/**
 * One line for a finished turn: what the gates decided and what it cost in steps. Read off the
 * projection, so it says what the harness reported and nothing the model claimed.
 */
function summarizeTurn(view: SessionView): string {
  const failed = view.gates.filter((gate) => gate.status === "failed" && gate.blocking);
  const passed = view.gates.filter((gate) => gate.status === "passed");
  const verdict = view.escalated
    ? `escalated at ${failed.map((gate) => gate.gateId).join(", ") || "a gate"}`
    : view.stopReason !== null && view.stopReason !== "completed"
      ? `stopped: ${view.stopReason}`
      : failed.length > 0
        ? `gates failed: ${failed.map((gate) => gate.gateId).join(", ")}`
        : `${passed.length} gate(s) passed`;
  return `${verdict}, ${view.steps} step(s)`;
}

function interactiveInterface(options: SessionInterfaceOptions): SessionInterface {
  const store = createSessionStore();
  const confirmations = createConfirmationQueue();
  const startedAt = options.clock.now();

  let state: ViewState = initialViewState;
  let evidence: EvidenceSummary | null = null;
  let redraw = (): void => {};
  const held: string[] = [];
  let onCancel = (): void => {};
  let onPanelClosed = (): void => {};
  let ticking = true;
  let mounted = true;
  let onTaskTyped: (task: string | null) => void = () => {};
  let currentTask = options.task;
  const transcript: TranscriptLine[] = [];
  /** When the activity now showing began, so the line can say how long it has been going. */
  let activityStartedAt: number | null = null;

  const submitTask = (task: string): void => {
    const settle = onTaskTyped;
    onTaskTyped = () => {};
    settle(task);
  };

  /**
   * Detach means the screen goes away and the run carries on. It used to mean neither.
   *
   * `detached` was set and read by three things that all happen after the fact: confirmations
   * auto-refuse, the evidence panel prints instead of drawing, and a waiting panel promise
   * resolves. Nothing unmounted Ink and nothing rendered differently, so the screen kept
   * painting over the terminal and the readme's "leaves the view and lets the run finish" was
   * true of the second half only. Unmounting here is what makes the first half true, and the
   * run continues because nothing about the loop is owned by the view.
   */
  const detach = (): void => {
    if (!mounted) {
      return;
    }
    mounted = false;
    ticking = false;
    onTaskTyped(null);
    instance.unmount();
    for (const line of held) {
      options.writeLine(line);
    }
    held.length = 0;
    options.writeLine("detached: the screen is gone and the run is still going.");
  };

  const dispatch = (action: ViewAction): void => {
    const before = state;
    state = applyViewAction(state, action);
    if (!before.cancelRequested && state.cancelRequested) {
      onCancel();
    }
    if (before.evidenceOpen && !state.evidenceOpen) {
      onPanelClosed();
    }
    if (!before.detached && state.detached) {
      onPanelClosed();
      detach();
    }
    if (mounted) {
      redraw();
    }
  };

  const open = (target: OpenTarget): void => {
    if (evidence === null) {
      return;
    }
    void openEvidenceTarget({
      location: evidence.location,
      target,
      platform: options.platform,
      env: {},
      spawn: options.spawnOpen,
    }).then((outcome) => {
      dispatch({ type: "note-open", notice: outcome.detail });
    });
  };

  const instance = render(
    createElement(SessionScreen, {
      store,
      viewState: state,
      dispatch,
      confirmations,
      onOpen: open,
      onSubmitTask: submitTask,
      transcript,
      activityElapsedMs: () =>
        activityStartedAt === null ? 0 : options.clock.now() - activityStartedAt,
      theme: options.theme,
      bindings: options.bindings,
      task: currentTask,
      workspace: options.workspace,
      evidence,
    }),
    { exitOnCtrlC: false },
  );

  redraw = (): void => {
    // Before the frame rather than after it, so the entries the last one wrote are gone
    // whether or not React had finished flushing them when it returned.
    drainRenderTimings();
    instance.rerender(
      createElement(SessionScreen, {
        store,
        viewState: state,
        dispatch,
        confirmations,
        onOpen: open,
        onSubmitTask: submitTask,
        transcript,
        activityElapsedMs: () =>
          activityStartedAt === null ? 0 : options.clock.now() - activityStartedAt,
        theme: options.theme,
        bindings: options.bindings,
        task: currentTask,
        workspace: options.workspace,
        evidence,
      }),
    );
  };

  // The elapsed counter, off the injected clock rather than a timer of its own, so the one
  // ambient thing the screen needs still enters at the composition root (invariant 8).
  void (async () => {
    while (ticking) {
      await options.clock.sleep(store.getView().activity === null ? idleTickMs : workingTickMs);
      if (!ticking) {
        return;
      }
      dispatch({ type: "tick", elapsedMs: options.clock.now() - startedAt });
    }
  })();

  return {
    emit(event: LoopEvent): void {
      const before = store.getView().activity;
      store.apply(event);
      const after = store.getView().activity;
      if (after !== before) {
        activityStartedAt = after === null ? null : options.clock.now();
      }
      if (!mounted) {
        // The screen is gone, so the run reports the way it does off a terminal. Without this
        // detaching would leave the person watching nothing at all.
        const line = describeLoopEvent(event);
        if (line !== null) {
          options.writeLine(line);
        }
      }
      if (event.type === "stopped" || event.type === "escalated") {
        dispatch({ type: "run-finished" });
      }
    },
    note(line: string): void {
      if (!mounted) {
        options.writeLine(line);
        return;
      }
      held.push(line);
    },
    confirm: (request) => (state.detached ? Promise.resolve(false) : confirmations.ask(request)),
    cancelled: () =>
      new Promise<void>((resolve) => {
        if (state.cancelRequested) {
          resolve();
          return;
        }
        onCancel = resolve;
      }),
    presentEvidence(summary: EvidenceSummary): Promise<void> {
      evidence = summary;
      if (state.detached) {
        for (const line of describeEvidence(summary, null)) {
          options.writeLine(line);
        }
        return Promise.resolve();
      }
      if (options.openEvidence === "always") {
        open("review");
      }
      return new Promise<void>((resolve) => {
        onPanelClosed = resolve;
        dispatch({ type: "open-evidence" });
      });
    },
    readTask(): Promise<string | null> {
      if (!mounted) {
        return Promise.resolve(null);
      }
      dispatch({ type: "compose-start" });
      return new Promise<string | null>((resolve) => {
        onTaskTyped = resolve;
      });
    },
    beginTurn(task: string): void {
      // What the last turn came to, kept before the stream is cleared for this one. Clearing
      // without keeping it is a screen that forgets, which is the opposite of what a person
      // holds a session open for.
      const finished = store.getView();
      if (finished.stopReason !== null || finished.escalated) {
        transcript.push({ text: currentTask, kind: "task" });
        transcript.push({ text: summarizeTurn(finished), kind: "outcome" });
      }
      store.reset();
      currentTask = task;
      dispatch({ type: "scroll-to-tail" });
    },
    async stop(): Promise<void> {
      ticking = false;
      confirmations.refuseAll();
      onTaskTyped(null);
      if (mounted) {
        mounted = false;
        instance.unmount();
      }
      await instance.waitUntilExit();
      // Written now the screen is gone, so they land in the scrollback in the order they
      // happened rather than inside a frame that was being redrawn around them.
      for (const line of held) {
        options.writeLine(line);
      }
      held.length = 0;
    },
  };
}
