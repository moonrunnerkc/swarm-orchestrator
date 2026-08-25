import { describe, expect, it } from "vitest";
import { createWorkPool, defaultWorkerConcurrency } from "./pool.ts";

/** A task that reports when it started and finishes only when told to. */
function held() {
  let release = () => {};
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { done, release };
}

describe("the work pool", () => {
  it("runs every task and returns their values in the order they were given", async () => {
    const pool = createWorkPool(2);

    const values = await Promise.all(
      [1, 2, 3, 4, 5].map((value) => pool.run(() => Promise.resolve(value * 2))),
    );

    expect(values).toEqual([2, 4, 6, 8, 10]);
  });

  it("never has more than the limit in flight at once", async () => {
    const pool = createWorkPool(2);
    let running = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 6 }, () =>
        pool.run(async () => {
          running += 1;
          peak = Math.max(peak, running);
          await Promise.resolve();
          running -= 1;
        }),
      ),
    );

    expect(peak).toBe(2);
  });

  it("starts a waiting task as soon as a slot frees", async () => {
    const pool = createWorkPool(1);
    const first = held();
    const second = held();
    let secondStarted = false;

    const running = Promise.all([
      pool.run(() => first.done),
      pool.run(() => {
        secondStarted = true;
        return second.done;
      }),
    ]);

    await Promise.resolve();
    expect(secondStarted).toBe(false);

    first.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(secondStarted).toBe(true);

    second.release();
    await running;
  });

  it("frees the slot a failing task held, rather than wedging the pool", async () => {
    const pool = createWorkPool(1);

    await expect(pool.run(() => Promise.reject(new Error("worktree add failed")))).rejects.toThrow(
      "worktree add failed",
    );

    await expect(pool.run(() => Promise.resolve("after"))).resolves.toBe("after");
  });

  it("runs everything at once when the limit is not a limit", async () => {
    const pool = createWorkPool(0);
    let running = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 4 }, () =>
        pool.run(async () => {
          running += 1;
          peak = Math.max(peak, running);
          await Promise.resolve();
          running -= 1;
        }),
      ),
    );

    expect(peak).toBe(4);
  });
});

describe("how many workers a run should start at once by default", () => {
  it("starts one at a time against a local model server", () => {
    expect(defaultWorkerConcurrency({ servedLocally: true, cores: 18 })).toBe(1);
  });

  it("ignores the core count entirely when the model is served locally", () => {
    expect(defaultWorkerConcurrency({ servedLocally: true, cores: 128 })).toBe(1);
  });

  it("does not scale with cores when the model is served elsewhere", () => {
    const onManyCores = defaultWorkerConcurrency({ servedLocally: false, cores: 128 });
    const onFew = defaultWorkerConcurrency({ servedLocally: false, cores: 8 });

    expect(onManyCores).toBe(onFew);
    expect(onManyCores).toBeLessThanOrEqual(4);
  });

  it("leaves a core free on a small machine, because each worker runs the test suite", () => {
    expect(defaultWorkerConcurrency({ servedLocally: false, cores: 2 })).toBe(1);
  });

  it("never returns zero, which would mean no cap rather than no workers", () => {
    for (const cores of [0, 1, 2, 4, 18]) {
      expect(defaultWorkerConcurrency({ servedLocally: false, cores })).toBeGreaterThan(0);
      expect(defaultWorkerConcurrency({ servedLocally: true, cores })).toBeGreaterThan(0);
    }
  });
});
