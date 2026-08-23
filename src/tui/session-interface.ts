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
import { SessionScreen } from "./screen.ts";
import { createSessionStore } from "./session-store.ts";
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
   * The chokepoint's prompt. On the interactive path it is a component inside the running
   * screen, answered by the same key dispatcher; on every other path it is what it was.
   */
  readonly confirm: ConfirmationPrompt;
  /** Resolves when the person asks to stop the run, and never otherwise. */
  cancelled(): Promise<void>;
  /** Shows what the run produced, and offers to open it. Returns when the panel is done with. */
  presentEvidence(summary: EvidenceSummary): Promise<void>;
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
  readonly openEvidence: OpenEvidencePolicy;
  readonly spawnOpen: SpawnHandler;
  readonly platform: NodeJS.Platform;
}

/** What happens when a run finishes: ask, always open, or never open. Never opens off a TTY. */
export type OpenEvidencePolicy = "ask" | "always" | "never";

/** How often the elapsed counter moves. A second is what a person reads; anything faster is noise. */
const tickMs = 1_000;

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

function interactiveInterface(options: SessionInterfaceOptions): SessionInterface {
  const store = createSessionStore();
  const confirmations = createConfirmationQueue();
  const startedAt = options.clock.now();

  let state: ViewState = initialViewState;
  let evidence: EvidenceSummary | null = null;
  let redraw = (): void => {};
  let onCancel = (): void => {};
  let onPanelClosed = (): void => {};
  let ticking = true;

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
    }
    redraw();
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
      theme: options.theme,
      bindings: options.bindings,
      task: options.task,
      workspace: options.workspace,
      evidence,
    }),
    { exitOnCtrlC: false },
  );

  redraw = (): void => {
    instance.rerender(
      createElement(SessionScreen, {
        store,
        viewState: state,
        dispatch,
        confirmations,
        onOpen: open,
        theme: options.theme,
        bindings: options.bindings,
        task: options.task,
        workspace: options.workspace,
        evidence,
      }),
    );
  };

  // The elapsed counter, off the injected clock rather than a timer of its own, so the one
  // ambient thing the screen needs still enters at the composition root (invariant 8).
  void (async () => {
    while (ticking) {
      await options.clock.sleep(tickMs);
      if (!ticking) {
        return;
      }
      dispatch({ type: "tick", elapsedMs: options.clock.now() - startedAt });
    }
  })();

  return {
    emit(event: LoopEvent): void {
      store.apply(event);
      if (event.type === "stopped" || event.type === "escalated") {
        dispatch({ type: "run-finished" });
      }
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
    async stop(): Promise<void> {
      ticking = false;
      confirmations.refuseAll();
      instance.unmount();
      await instance.waitUntilExit();
    },
  };
}
