import type { Clock } from "../core/clock.ts";

/** Cleanup has a separate allowance and cannot consume a renewed model or implementation budget. */
export async function withControllerCleanup<T>(
  clock: Clock,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const deadline = new AbortController();
  const release = new AbortController();
  void clock.sleep(60000, release.signal, "deadline").then(() => {
    if (!release.signal.aborted)
      deadline.abort(
        new Error(
          "controller cleanup allowance exhausted; preserve remaining resources for repair",
        ),
      );
  });
  try {
    return await operation(deadline.signal);
  } finally {
    release.abort();
  }
}
