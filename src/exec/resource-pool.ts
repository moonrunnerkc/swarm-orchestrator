export interface ResourcePool {
  run<Value>(operation: () => Promise<Value>, signal?: AbortSignal): Promise<Value>;
}

/** FIFO permits belong to admitted operations, including the handoff to a queued waiter. */
export function createResourcePool(limit: number): ResourcePool {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("resource concurrency must be a positive integer");
  let occupied = 0;
  const waiting: {
    grant: () => void;
    reject: (cause: unknown) => void;
    signal?: AbortSignal;
    cancel: () => void;
  }[] = [];
  function release(): void {
    const next = waiting.shift();
    if (next === undefined) {
      occupied -= 1;
      return;
    }
    next.signal?.removeEventListener("abort", next.cancel);
    next.grant();
  }
  return {
    async run(operation, signal) {
      signal?.throwIfAborted();
      if (occupied < limit) occupied += 1;
      else
        await new Promise<void>((grant, reject) => {
          const entry = {
            grant,
            reject,
            ...(signal === undefined ? {} : { signal }),
            cancel: () => {
              const index = waiting.indexOf(entry);
              if (index !== -1) waiting.splice(index, 1);
              reject(signal?.reason);
            },
          };
          waiting.push(entry);
          signal?.addEventListener("abort", entry.cancel, { once: true });
        });
      try {
        signal?.throwIfAborted();
        return await operation();
      } finally {
        release();
      }
    },
  };
}
