import type { LoopEvent } from "../core/loop-events.ts";
import { applyLoopEventAt, emptySessionView, type SessionView } from "./session-view.ts";

export interface SessionStore {
  getView(): SessionView;
  /** `elapsedMs` is how far into the run the event landed, off the clock the caller holds. */
  apply(event: LoopEvent, elapsedMs?: number): void;
  /**
   * Back to nothing, for the next turn of a session. The ledger keeps every turn; the screen
   * does not, because a second task rendered under the first one's plan and gates reads as one
   * long run rather than as two pieces of work.
   */
  reset(): void;
  subscribe(listener: (view: SessionView) => void): () => void;
}

/** Holds the projection the screen reads. Nothing else in the TUI keeps state. */
export function createSessionStore(): SessionStore {
  let view = emptySessionView;
  const listeners = new Set<(view: SessionView) => void>();

  return {
    getView: () => view,
    apply(event: LoopEvent, elapsedMs = 0): void {
      view = applyLoopEventAt(view, event, elapsedMs);
      for (const listener of listeners) {
        listener(view);
      }
    },
    reset(): void {
      view = emptySessionView;
      for (const listener of listeners) {
        listener(view);
      }
    },
    subscribe(listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
