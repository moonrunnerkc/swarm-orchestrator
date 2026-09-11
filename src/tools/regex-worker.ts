import { Worker } from "node:worker_threads";

const source = `const { parentPort, workerData } = require("node:worker_threads");
const expression = new RegExp(workerData);
parentPort.on("message", lines => parentPort.postMessage(lines.map(line => expression.test(line))));`;

/** Regex matching runs in a disposable worker so the timeout can stop an executing match. */
export function createRegexMatcher(pattern: string, timeoutMs: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const worker = new Worker(source, {
    eval: true,
    workerData: pattern,
    resourceLimits: { maxOldGenerationSizeMb: 16, maxYoungGenerationSizeMb: 4 },
  });
  let closed = false;
  let workerFailure: Error | undefined;
  worker.on("error", (cause) => {
    workerFailure = cause;
    closed = true;
  });
  worker.on("exit", () => {
    closed = true;
  });
  return {
    async match(lines: readonly string[]): Promise<readonly boolean[]> {
      signal?.throwIfAborted();
      if (closed)
        throw workerFailure ?? new Error("search matcher is closed; retry with a narrower search");
      return new Promise((resolve, reject) => {
        const finish = (failure?: Error, matches?: readonly boolean[]) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", cancel);
          worker.off("message", receive);
          worker.off("error", error);
          worker.off("exit", exit);
          if (failure !== undefined) {
            closed = true;
            void worker.terminate();
            reject(failure);
          } else resolve(matches ?? []);
        };
        const cancel = () => finish(new Error("search cancelled"));
        const receive = (matches: readonly boolean[]) => finish(undefined, matches);
        const error = (cause: Error) => finish(cause);
        const exit = () => finish(new Error("search worker exited before completing the match"));
        const timer = setTimeout(
          () =>
            finish(
              new Error(
                "search pattern exceeded its execution deadline; narrow the pattern or scope",
              ),
            ),
          timeoutMs,
        );
        signal?.addEventListener("abort", cancel, { once: true });
        worker.once("message", receive);
        worker.once("error", error);
        worker.once("exit", exit);
        if (signal?.aborted) cancel();
        else worker.postMessage(lines);
      });
    },
    async close() {
      closed = true;
      await worker.terminate();
    },
  };
}
