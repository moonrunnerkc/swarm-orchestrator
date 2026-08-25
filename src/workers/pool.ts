/**
 * A cap on how many workers are in flight at once.
 *
 * Fanning out with Promise.all was fine at one worker per task. Running each task several
 * ways multiplies it: four tasks tried four ways is sixteen `git worktree add` calls
 * contending on one repository's `.git/worktrees`, and sixteen copies of the project's real
 * test suite on one machine. The slot has to cover the whole worktree lifetime, add through
 * remove, rather than the agent loop alone, or the cap makes the contention it was added to
 * prevent no rarer and the suites no lighter.
 */
export interface WorkPool {
  run<T>(task: () => Promise<T>): Promise<T>;
}

/** A limit of zero or less is no limit, which is what the single-attempt path wants. */
export function createWorkPool(limit: number): WorkPool {
  if (limit <= 0) {
    return { run: (task) => task() };
  }

  let inFlight = 0;
  const waiting: (() => void)[] = [];

  function release(): void {
    inFlight -= 1;
    waiting.shift()?.();
  }

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (inFlight >= limit) {
        await new Promise<void>((resolve) => waiting.push(resolve));
      }
      inFlight += 1;
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}
