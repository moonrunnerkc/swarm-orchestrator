import type { ConfirmationRequest } from "../tools/chokepoint.ts";

/**
 * The bridge between the chokepoint's confirmation prompt and the running screen. Ink owns
 * stdin in raw mode, so a second reader on the same stream drops keystrokes, and the one
 * place that must never drop one is the provenance-confirmation path (invariant 5). The
 * request becomes state the screen renders and the key dispatcher answers.
 */

export interface PendingConfirmation {
  readonly request: ConfirmationRequest;
  /** Idempotent: a second answer for the same request is ignored rather than racing. */
  answer(approved: boolean): void;
}

export interface ConfirmationQueue {
  /** The `ConfirmationPrompt` the chokepoint calls. Resolves when a key answers it. */
  ask(request: ConfirmationRequest): Promise<boolean>;
  current(): PendingConfirmation | null;
  subscribe(listener: (pending: PendingConfirmation | null) => void): () => void;
  /** Refuses everything still waiting. Called when the view goes away mid-question. */
  refuseAll(): void;
}

export function createConfirmationQueue(): ConfirmationQueue {
  const waiting: { request: ConfirmationRequest; settle: (approved: boolean) => void }[] = [];
  const listeners = new Set<(pending: PendingConfirmation | null) => void>();

  const head = (): PendingConfirmation | null => {
    const first = waiting[0];
    if (first === undefined) {
      return null;
    }
    return {
      request: first.request,
      answer(approved: boolean): void {
        if (waiting[0] !== first) {
          return;
        }
        waiting.shift();
        first.settle(approved);
        announce();
      },
    };
  };

  function announce(): void {
    const pending = head();
    for (const listener of listeners) {
      listener(pending);
    }
  }

  return {
    ask(request: ConfirmationRequest): Promise<boolean> {
      return new Promise<boolean>((settle) => {
        waiting.push({ request, settle });
        announce();
      });
    },
    current: head,
    subscribe(listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refuseAll(): void {
      while (waiting.length > 0) {
        waiting.shift()?.settle(false);
      }
      announce();
    },
  };
}
