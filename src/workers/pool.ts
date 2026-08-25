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

/**
 * How many workers to start at once when nobody said.
 *
 * Not a core count. A core count was the first answer here and it was wrong in a way that
 * took a local model server down: eighteen cores meant seventeen workers, each holding a
 * worktree, each running the project's real test suite, and each driving its own agent loop
 * against one model. Cores measure none of those three things.
 *
 * Where the model is served locally the answer is one. A local server holds one model
 * resident and every worker in the run is asking that same process for tokens, so the
 * parallelism buys nothing and costs the memory the model is living in. Continuous batching
 * does not save it: three concurrent loops against a 27b on this machine aborted the server.
 *
 * Where the model is served elsewhere the bound is the machine rather than the backend, and
 * what the machine is actually being asked for is N copies of the project's test suite. Four
 * is a modest answer to that and deliberately does not grow with the hardware, because a
 * bigger machine does not make a project's suite cheaper to run four more times. Anyone who
 * knows their own situation better passes `--concurrency`.
 */
export function defaultWorkerConcurrency(machine: {
  readonly servedLocally: boolean;
  readonly cores: number;
}): number {
  if (machine.servedLocally) {
    return 1;
  }
  return Math.max(1, Math.min(4, machine.cores - 1));
}
