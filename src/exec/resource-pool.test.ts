import { expect, it } from "vitest";
import { createResourcePool } from "./resource-pool.ts";

it("removes cancelled queue entries without dispatching them or stealing a permit", async () => {
  const pool = createResourcePool(1);
  const calls: string[] = [];
  let unblock = () => {};
  const first = pool.run(
    () =>
      new Promise<void>((resolve) => {
        unblock = resolve;
        calls.push("first");
      }),
  );
  const stop = new AbortController();
  const cancelled = pool.run(async () => {
    calls.push("cancelled");
  }, stop.signal);
  const final = pool.run(async () => {
    calls.push("final");
  });
  stop.abort(new Error("cancelled while queued"));
  await expect(cancelled).rejects.toThrow("cancelled while queued");
  expect(calls).toEqual(["first"]);
  unblock();
  await Promise.all([first, final]);
  expect(calls).toEqual(["first", "final"]);
});

it("hands permits to waiters before admitting new arrivals", async () => {
  const pool = createResourcePool(1);
  const observed: number[] = [];
  await Promise.all(
    [0, 1, 2, 3].map((index) =>
      pool.run(async () => {
        observed.push(index);
      }),
    ),
  );
  expect(observed).toEqual([0, 1, 2, 3]);
});
