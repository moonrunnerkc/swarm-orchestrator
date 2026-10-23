import type { Clock } from "./core/clock.ts";
import type { RandomSource } from "./core/random-source.ts";

/** The ambient time source and timer, injectable so a test can make a timer fire early. */
export interface SystemTime {
  readonly now: () => number;
  readonly setTimer: (callback: () => void, milliseconds: number) => unknown;
  readonly clearTimer: (timer: unknown) => void;
}

const ambientTime: SystemTime = {
  now: () => Date.now(),
  setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

/**
 * The ambient clock lives at the composition root; src/core only ever sees the port.
 *
 * Node's timers can fire up to a millisecond before `Date.now()` shows the whole interval, and a
 * deadline that checks the elapsed time when its sleep resolves would then be dropped. The sleep
 * re-arms for whatever is left until `now()` has advanced by the full interval, so it keeps the
 * Clock contract on the clock's own time.
 */
export function createSystemClock(time: SystemTime = ambientTime): Clock {
  return {
    now: time.now,
    sleep: (milliseconds, cancel) =>
      new Promise((resolveSleep) => {
        if (cancel?.aborted) {
          resolveSleep();
          return;
        }
        const until = time.now() + milliseconds;
        let timer: unknown;
        const arm = (wait: number): void => {
          timer = time.setTimer(() => {
            const left = until - time.now();
            if (left > 0) {
              arm(left);
              return;
            }
            cancel?.removeEventListener("abort", onCancel);
            resolveSleep();
          }, wait);
        };
        function onCancel(): void {
          time.clearTimer(timer);
          resolveSleep();
        }
        cancel?.addEventListener("abort", onCancel, { once: true });
        arm(milliseconds);
      }),
  };
}

export function createSystemRandom(): RandomSource {
  return { next: () => Math.random() };
}
