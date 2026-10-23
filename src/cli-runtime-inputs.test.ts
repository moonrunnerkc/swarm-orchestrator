import { describe, expect, it } from "vitest";
import { createSystemClock, type SystemTime } from "./cli-runtime-inputs.ts";

/** A time source whose timers fire when the test says, at whatever time the test has set. */
function scriptedTime(): SystemTime & {
  set(now: number): void;
  fireNext(): void;
  readonly armed: number[];
} {
  let current = 0;
  const pending: { callback: () => void; cleared: boolean }[] = [];
  const armed: number[] = [];
  return {
    now: () => current,
    setTimer: (callback, milliseconds) => {
      const timer = { callback, cleared: false };
      pending.push(timer);
      armed.push(milliseconds);
      return timer;
    },
    clearTimer: (timer) => {
      (timer as { cleared: boolean }).cleared = true;
    },
    set: (now) => {
      current = now;
    },
    fireNext: () => {
      const timer = pending.shift();
      if (timer !== undefined && !timer.cleared) timer.callback();
    },
    armed,
  };
}

const settled = async (promise: Promise<void>): Promise<boolean> => {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  return done;
};

describe("the system clock's sleep", () => {
  it("does not resolve when its timer fires before the clock shows the whole interval", async () => {
    // Node's timers fire up to a millisecond early against Date.now(): 4 of 4,000 in a trial.
    // A deadline that then found less than its interval elapsed was dropped, and a model call
    // that never returned held the run past its wall (two CI hangs at the 60 s test limit).
    const time = scriptedTime();
    const sleep = createSystemClock(time).sleep(100, new AbortController().signal, "deadline");
    time.set(99);
    time.fireNext();
    expect(await settled(sleep)).toBe(false);
    expect(time.armed).toEqual([100, 1]);
    time.set(100);
    time.fireNext();
    expect(await settled(sleep)).toBe(true);
  });

  it("resolves at once when cancelled, and clears the re-armed timer", async () => {
    const time = scriptedTime();
    const cancel = new AbortController();
    const sleep = createSystemClock(time).sleep(100, cancel.signal, "deadline");
    time.set(99);
    time.fireNext();
    cancel.abort();
    expect(await settled(sleep)).toBe(true);
    time.set(100);
    time.fireNext();
    expect(time.armed).toEqual([100, 1]);
  });

  it("waits the whole interval on the real timer", async () => {
    const clock = createSystemClock();
    const started = clock.now();
    await clock.sleep(25);
    expect(clock.now() - started).toBeGreaterThanOrEqual(25);
  });
});
