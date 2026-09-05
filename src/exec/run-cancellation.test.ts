import { describe, expect, it } from "vitest";
import { createRunCancellation } from "./run-cancellation.ts";

/** A clock a test drives, so a deadline is exercised without waiting for one. */
function testClock() {
  let now = 0;
  const sleepers: { at: number; settle: () => void }[] = [];
  return {
    clock: {
      now: () => now,
      sleep: (ms: number) =>
        new Promise<void>((settle) => {
          sleepers.push({ at: now + ms, settle });
        }),
    },
    advance(ms: number) {
      now += ms;
      for (const sleeper of sleepers.filter((one) => one.at <= now)) {
        sleeper.settle();
      }
    },
  };
}

describe("one place a run is stopped from", () => {
  it("is not aborted while the run is inside its budget", async () => {
    const { clock } = testClock();
    const cancellation = createRunCancellation({ clock, wallBudgetMs: 60_000 });

    expect(cancellation.signal.aborted).toBe(false);
    expect(cancellation.reason()).toBeNull();
    cancellation.dispose();
  });

  it("aborts the whole run at its wall budget, whatever is still running", async () => {
    const driver = testClock();
    const cancellation = createRunCancellation({ clock: driver.clock, wallBudgetMs: 60_000 });

    driver.advance(60_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(cancellation.signal.aborted).toBe(true);
    expect(cancellation.reason()).toBe("deadline");
    cancellation.dispose();
  });

  it("reports how much of the budget is left, so a worker gets the rest and not a fresh one", () => {
    const driver = testClock();
    const cancellation = createRunCancellation({ clock: driver.clock, wallBudgetMs: 60_000 });

    driver.advance(20_000);

    expect(cancellation.remainingMs()).toBe(40_000);
    cancellation.dispose();
  });

  it("never hands out a negative remainder", () => {
    const driver = testClock();
    const cancellation = createRunCancellation({ clock: driver.clock, wallBudgetMs: 1_000 });

    driver.advance(5_000);

    expect(cancellation.remainingMs()).toBe(0);
    cancellation.dispose();
  });

  it("has no deadline where the run was given no budget", () => {
    const { clock } = testClock();
    const cancellation = createRunCancellation({ clock, wallBudgetMs: null });

    expect(cancellation.remainingMs()).toBeNull();
    cancellation.dispose();
  });

  it("carries the reason a person stopped it, apart from a deadline", () => {
    const { clock } = testClock();
    const cancellation = createRunCancellation({ clock, wallBudgetMs: null });

    cancellation.cancel("interrupted");

    expect(cancellation.signal.aborted).toBe(true);
    expect(cancellation.reason()).toBe("interrupted");
    cancellation.dispose();
  });

  it("keeps the first reason, because what stopped a run is not the second thing to notice", () => {
    const { clock } = testClock();
    const cancellation = createRunCancellation({ clock, wallBudgetMs: null });

    cancellation.cancel("interrupted");
    cancellation.cancel("terminated");

    expect(cancellation.reason()).toBe("interrupted");
    cancellation.dispose();
  });
});
