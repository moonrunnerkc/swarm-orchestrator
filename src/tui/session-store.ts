import type { LoopEvent } from "../core/loop-events.ts";
import { applyLoopEvent, emptySessionView, type SessionView } from "./session-view.ts";

export interface SessionStore {
  getView(): SessionView;
  apply(event: LoopEvent): void;
  subscribe(listener: (view: SessionView) => void): () => void;
}

/** Holds the projection the screen reads. Nothing else in the TUI keeps state. */
export function createSessionStore(): SessionStore {
  let view = emptySessionView;
  const listeners = new Set<(view: SessionView) => void>();

  return {
    getView: () => view,
    apply(event: LoopEvent): void {
      view = applyLoopEvent(view, event);
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
