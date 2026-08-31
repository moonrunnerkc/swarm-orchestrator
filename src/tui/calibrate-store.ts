import {
  applyCalibrateEvent,
  type CalibrateEvent,
  type CalibrateView,
  emptyCalibrateView,
} from "./calibrate-view.ts";

export interface CalibrateStore {
  getView(): CalibrateView;
  apply(event: CalibrateEvent): void;
  subscribe(listener: (view: CalibrateView) => void): () => void;
}

/** Holds the projection the sweep's screen reads, exactly as `session-store.ts` does for a run. */
export function createCalibrateStore(): CalibrateStore {
  let view = emptyCalibrateView;
  const listeners = new Set<(view: CalibrateView) => void>();

  return {
    getView: () => view,
    apply(event: CalibrateEvent): void {
      view = applyCalibrateEvent(view, event);
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
