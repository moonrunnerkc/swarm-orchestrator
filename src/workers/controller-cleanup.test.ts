import { expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { withControllerCleanup } from "./controller-cleanup.ts";

it("stops cooperative cleanup at its separate deadline even after work cancellation", async () => {
  const clock = createTestClock(1000);
  const work = new AbortController();
  work.abort();
  let allowed = false;
  const cleanup = withControllerCleanup(clock, (signal) => {
    allowed = !signal.aborted && work.signal.aborted;
    return new Promise<never>((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
    );
  });
  expect(allowed).toBe(true);
  clock.advance(60000);
  await expect(cleanup).rejects.toThrow("cleanup allowance exhausted");
});
it("releases the cleanup deadline after ordinary completion", async () => {
  const clock = createTestClock(1000);
  let signal: AbortSignal | undefined;
  expect(
    await withControllerCleanup(clock, async (active) => {
      signal = active;
      return "removed";
    }),
  ).toBe("removed");
  clock.advance(60000);
  await Promise.resolve();
  expect(signal?.aborted).toBe(false);
});
