import { join } from "node:path";
import { z } from "zod";
import type { Clock } from "../core/clock.ts";
import type { RandomSource } from "../core/random-source.ts";
import { openRunStore } from "../durable/run-store.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";

const holderSchema = z.strictObject({
  pid: z.number().int().positive(),
  sequence: z.number().int().positive(),
  startedAt: z.number(),
  nonce: z.number(),
});
let acquisitionSequence = 0;
export interface ControllerOwner {
  assertOwned(): void;
  release(): void;
}

/** A live or unobservable process is never killed or assumed stale, including a reused PID. */
export function acquireControllerOwner(options: {
  evidence: EvidenceRecorder;
  clock: Clock;
  random: RandomSource;
  runtime?: { pid: number; probe: (pid: number) => "alive" | "absent" | "unknown" };
}): ControllerOwner {
  const runtime = options.runtime ?? {
    pid: process.pid,
    probe: (pid: number) => {
      try {
        process.kill(pid, 0);
        return "alive" as const;
      } catch (cause) {
        return (cause as NodeJS.ErrnoException).code === "ESRCH"
          ? ("absent" as const)
          : ("unknown" as const);
      }
    },
  };
  const store = openRunStore(join(options.evidence.directory, "ownership.jsonl"));
  const runId = options.evidence.sessionId;
  const path = options.evidence.directory;
  if (store.run(runId) === null)
    store.startRun({
      runId,
      specDigest: options.evidence.head().hash,
      task: "controller writer ownership",
      startedAt: options.clock.now(),
    });
  const previous = store.leases(runId).find((lease) => lease.path === path);
  if (previous !== undefined) {
    const owner = holderSchema.parse(JSON.parse(previous.holder));
    const observed = runtime.probe(owner.pid);
    if (observed !== "absent")
      throw new Error(
        `controller is owned by process ${owner.pid} (${observed}); no work or resource cleanup was started`,
      );
    // The journal transaction compares the old holder, so a competing recovery cannot release a new owner.
    store.releaseLease({ runId, path, holder: previous.holder });
  }
  const holder = JSON.stringify(
    holderSchema.parse({
      pid: runtime.pid,
      sequence: ++acquisitionSequence,
      startedAt: options.clock.now(),
      nonce: options.random.next(),
    }),
  );
  if (!store.acquireLease({ runId, path, holder, at: options.clock.now() }))
    throw new Error(
      "another controller acquired this session during recovery; no effects were started",
    );
  return {
    assertOwned() {
      if (store.leases(runId).find((lease) => lease.path === path)?.holder !== holder)
        throw new Error("controller writer ownership changed; stop and reconcile");
    },
    release() {
      store.releaseLease({ runId, path, holder });
      store.close();
    },
  };
}
