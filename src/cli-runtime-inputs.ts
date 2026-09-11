import type { Clock } from "./core/clock.ts";
import type { RandomSource } from "./core/random-source.ts";
/** The ambient clock lives at the composition root; src/core only ever sees the port. */
export function createSystemClock(): Clock {
  return {
    now: () => Date.now(),
    sleep: (milliseconds, cancel) =>
      new Promise((resolveSleep) => {
        if (cancel?.aborted) {
          resolveSleep();
          return;
        }
        const timer = setTimeout(() => {
          cancel?.removeEventListener("abort", onCancel);
          resolveSleep();
        }, milliseconds);
        function onCancel(): void {
          clearTimeout(timer);
          resolveSleep();
        }
        cancel?.addEventListener("abort", onCancel, { once: true });
      }),
  };
}

export function createSystemRandom(): RandomSource {
  return { next: () => Math.random() };
}
