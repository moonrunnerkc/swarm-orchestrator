import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { TransportTraceEntry, TransportTraceSink } from "./transport-trace.ts";

/**
 * The trace as JSONL at a path the operator named. Deliberately not the ledger: these entries
 * carry whole prompts and whole completions unscrubbed, and the ledger is the thing a bundle
 * ships. A debug artifact belongs where the person debugging put it.
 *
 * Writes are chained rather than fired in parallel, because two appends in flight interleave
 * and a half line is not a JSONL record.
 */
export function createFileTraceSink(path: string): TransportTraceSink {
  let pending: Promise<unknown> = mkdir(dirname(path), { recursive: true });

  return {
    write(entry: TransportTraceEntry): Promise<void> {
      pending = pending
        .then(() => appendFile(path, `${JSON.stringify(entry)}\n`, "utf8"))
        // A trace that cannot be written must not take the run with it: this is instrumentation,
        // and a failed debug write is not a failed model call.
        .catch(() => undefined);
      return pending as Promise<void>;
    },
  };
}
