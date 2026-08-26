import type { ConfirmationRequest } from "../tools/chokepoint.ts";

/**
 * The bridge between the chokepoint's confirmation prompt and the running screen. Ink owns
 * stdin in raw mode, so a second reader on the same stream drops keystrokes, and the one
 * place that must never drop one is the provenance-confirmation path (invariant 5). The
 * request becomes state the screen renders and the key dispatcher answers.
 *
 * A question nobody answers refuses itself. It used to wait for ever, and a run held on one
 * overnight had done nothing by morning: the model had asked at step two and there was no one
 * at the keyboard. Refusing is what the chokepoint records for a declined question either way,
 * so the deadline costs that tool call rather than the run, and the model is told and can take
 * another route.
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

export interface ConfirmationDeadline {
  /** Milliseconds before an unanswered question refuses itself. 0 waits for ever. */
  readonly timeoutMs: number;
  /** The run's own clock, so this is not a second source of time (invariant 8). */
  readonly sleep: (milliseconds: number) => Promise<void>;
}

interface Waiting {
  readonly request: ConfirmationRequest;
  readonly settle: (approved: boolean) => void;
  answered: boolean;
}

export function createConfirmationQueue(deadline?: ConfirmationDeadline): ConfirmationQueue {
  const waiting: Waiting[] = [];
  const listeners = new Set<(pending: PendingConfirmation | null) => void>();

  function announce(): void {
    const pending = head();
    for (const listener of listeners) {
      listener(pending);
    }
  }

  /** The one place a question is settled, so an answer and a deadline cannot both land. */
  function resolve(entry: Waiting, approved: boolean): void {
    if (entry.answered) {
      return;
    }
    entry.answered = true;
    const at = waiting.indexOf(entry);
    if (at !== -1) {
      waiting.splice(at, 1);
    }
    entry.settle(approved);
    announce();
  }

  function head(): PendingConfirmation | null {
    const first = waiting[0];
    if (first === undefined) {
      return null;
    }
    return {
      request: first.request,
      answer(approved: boolean): void {
        resolve(first, approved);
      },
    };
  }

  return {
    ask(request: ConfirmationRequest): Promise<boolean> {
      return new Promise<boolean>((settle) => {
        const entry: Waiting = { request, settle, answered: false };
        waiting.push(entry);
        announce();
        if (deadline !== undefined && deadline.timeoutMs > 0) {
          void deadline.sleep(deadline.timeoutMs).then(() => {
            resolve(entry, false);
          });
        }
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
      for (const entry of [...waiting]) {
        resolve(entry, false);
      }
    },
  };
}
