import type { Clock } from "../core/clock.ts";

/**
 * One place a run is stopped from.
 *
 * A wall budget that each worker applies to itself is not a budget for the run: ten workers
 * with half an hour each is five hours. `swarm parallel` was worse than that, because the
 * budget reached `runInParallel` through a spread into an options object that had no such
 * field, so a spread of a literal into a literal type-checks and the setting did nothing at
 * all. And the parallel command handed its workers an AbortController nobody ever aborted, so
 * a Ctrl-C reached the coordinator and nothing under it.
 *
 * So the deadline and every stop signal meet here, and what workers get is the remainder.
 */
export type CancellationReason = "interrupted" | "terminated" | "deadline" | "policy";

export interface RunCancellation {
  readonly signal: AbortSignal;
  /** Why the run was stopped, or null while it has not been. */
  reason(): CancellationReason | null;
  /** What is left of the whole run's budget, or null where it was given none. */
  remainingMs(): number | null;
  cancel(reason: CancellationReason): void;
  /** Releases the deadline timer. A run that finished early should not hold one. */
  dispose(): void;
}

export function createRunCancellation(options: {
  readonly clock: Clock;
  readonly wallBudgetMs: number | null;
}): RunCancellation {
  const controller = new AbortController();
  const startedAt = options.clock.now();
  const deadlineAt = options.wallBudgetMs === null ? null : startedAt + options.wallBudgetMs;
  let stopped: CancellationReason | null = null;
  const releaseDeadline = new AbortController();

  const cancel = (reason: CancellationReason): void => {
    // The first reason is kept: what stopped a run is not the second thing anyone noticed.
    if (stopped !== null) {
      return;
    }
    stopped = reason;
    releaseDeadline.abort();
    controller.abort(reason);
  };

  if (options.wallBudgetMs !== null) {
    void options.clock.sleep(options.wallBudgetMs, releaseDeadline.signal).then(
      () => {
        cancel("deadline");
      },
      () => {
        // The sleep was released because the run stopped for some other reason first.
      },
    );
  }

  return {
    signal: controller.signal,
    reason: () => stopped,
    remainingMs: () => (deadlineAt === null ? null : Math.max(0, deadlineAt - options.clock.now())),
    cancel,
    dispose: () => {
      releaseDeadline.abort();
    },
  };
}
