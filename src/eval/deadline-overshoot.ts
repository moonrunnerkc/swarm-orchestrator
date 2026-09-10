import { createRunCancellation } from "../exec/run-cancellation.ts";
import { runProcessGroup } from "../exec/run-process.ts";

/**
 * How far past its deadline a run actually goes.
 *
 * Gate 9 asks for overshoot below 2% in deterministic budget tests. The cancellation tree that
 * bounds a run existed and had no number against it, which is a mechanism rather than a
 * measurement. This is the measurement.
 *
 * What it times is the whole tree and not one link of it: the deadline timer fires, the
 * cancellation aborts, the abort reaches the process group, the group is signalled, the child
 * goes, and the run settles. A budget test that stopped at the abort would report a number about
 * a timer rather than about a run.
 */
export interface OvershootSample {
  readonly budgetMs: number;
  /** Wall time from arming the deadline to the run being settled and its child gone. */
  readonly stoppedAfterMs: number;
  /** How much of that was past the budget. Floored at zero: an early finish is not overshoot. */
  readonly overshootMs: number;
}

/**
 * The worst sample, by fraction of its own budget rather than by milliseconds.
 *
 * A larger budget makes any fixed overshoot look smaller, so ranking by milliseconds would let
 * the published number be improved by measuring a longer run. Null where nothing was measured,
 * which is not a fraction of zero.
 */
export function worstOvershoot(
  samples: readonly OvershootSample[],
): { readonly overshootMs: number; readonly fraction: number; readonly budgetMs: number } | null {
  let worst: OvershootSample | null = null;
  for (const sample of samples) {
    if (
      worst === null ||
      sample.overshootMs / sample.budgetMs > worst.overshootMs / worst.budgetMs
    ) {
      worst = sample;
    }
  }
  return worst === null
    ? null
    : {
        overshootMs: worst.overshootMs,
        fraction: worst.overshootMs / worst.budgetMs,
        budgetMs: worst.budgetMs,
      };
}

/**
 * A child that outlives its budget, stopped by the run's own deadline, timed.
 *
 * The per-command timeout is set far beyond the budget on purpose, so what stops the child is the
 * run deadline reaching it through the cancellation rather than the command's own clock. Those
 * are two different paths and only one of them is what gate 9 is about.
 *
 * The clock is the wall clock here rather than an injected one. A driven clock reports zero
 * overshoot by construction, which is the one answer this measurement cannot be allowed to give.
 */
export async function measureDeadlineOvershoot(options: {
  readonly budgetsMs: readonly number[];
  readonly repeats: number;
}): Promise<readonly OvershootSample[]> {
  const samples: OvershootSample[] = [];
  for (const budgetMs of options.budgetsMs) {
    for (let repeat = 0; repeat < options.repeats; repeat += 1) {
      samples.push(await oneSample(budgetMs));
    }
  }
  return samples;
}

async function oneSample(budgetMs: number): Promise<OvershootSample> {
  const clock = {
    now: () => Date.now(),
    sleep: (milliseconds: number, cancel?: AbortSignal) =>
      new Promise<void>((settle) => {
        const timer = setTimeout(settle, milliseconds);
        cancel?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            settle();
          },
          { once: true },
        );
      }),
  };
  const startedAt = Date.now();
  const cancellation = createRunCancellation({ clock, wallBudgetMs: budgetMs });
  try {
    await runProcessGroup(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      cwd: process.cwd(),
      env: {},
      timeoutMs: budgetMs * 100,
      maxOutputBytes: 4096,
      signal: cancellation.signal,
    });
  } finally {
    cancellation.dispose();
  }
  const stoppedAfterMs = Date.now() - startedAt;
  return { budgetMs, stoppedAfterMs, overshootMs: Math.max(0, stoppedAfterMs - budgetMs) };
}
