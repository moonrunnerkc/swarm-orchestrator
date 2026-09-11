import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { z } from "zod";
import { openRunStore } from "./run-store.ts";

const legacyRun = z.object({
  run_id: z.string(),
  spec_digest: z.string(),
  task: z.string(),
  state: z.string(),
  started_at: z.number(),
  ended_at: z.number().nullable(),
});
const legacyStep = z.object({
  run_id: z.string(),
  step_id: z.string(),
  kind: z.string(),
  idempotency_key: z.string(),
  state: z.string(),
  updated_at: z.number(),
});

/** Compatibility reader only. New administrative writes go exclusively to the JSONL journal. */
export function importLegacyRunStore(source: string, destination: string): number {
  if (!existsSync(source)) return 0;
  const digest = `sha256:${createHash("sha256").update(readFileSync(source)).digest("hex")}`;
  const marker = `${destination}.legacy-import`;
  if (existsSync(marker)) {
    if (readFileSync(marker, "utf8").trim() !== digest)
      throw new Error(
        "legacy run database changed after import; stop the old client and reconcile both histories",
      );
    return 0;
  }
  const { DatabaseSync } = createRequire(import.meta.url)(
    "node:sqlite",
  ) as typeof import("node:sqlite");
  const database = new DatabaseSync(source, { readOnly: true, allowExtension: false });
  try {
    const runs = z
      .array(legacyRun)
      .parse(
        database
          .prepare("SELECT run_id, spec_digest, task, state, started_at, ended_at FROM runs")
          .all(),
      );
    const steps = z
      .array(legacyStep)
      .parse(
        database
          .prepare("SELECT run_id, step_id, kind, idempotency_key, state, updated_at FROM steps")
          .all(),
      );
    const store = openRunStore(destination);
    for (const run of runs) {
      if (store.run(run.run_id) !== null)
        throw new Error(
          `legacy run ${run.run_id} conflicts with an existing journal entry; reconcile the histories before importing`,
        );
    }
    for (const run of runs) {
      if (store.run(run.run_id) === null) {
        store.startRun({
          runId: run.run_id,
          specDigest: run.spec_digest,
          task: run.task,
          startedAt: run.started_at,
        });
      }
      for (const step of steps.filter((entry) => entry.run_id === run.run_id)) {
        if (store.steps(run.run_id).some((entry) => entry.stepId === step.step_id)) continue;
        store.beginStep({
          runId: run.run_id,
          stepId: step.step_id,
          kind: step.kind,
          idempotencyKey: step.idempotency_key,
          at: step.updated_at,
        });
        store.failStep({
          runId: run.run_id,
          stepId: step.step_id,
          at: step.updated_at,
          reason: `legacy ${step.state} bookkeeping; completion must be reconciled against session evidence`,
        });
      }
      store.abortRun(
        run.run_id,
        `legacy administrative state ${run.state}, imported read-only from ${digest}; reconcile against session evidence before continuing`,
        run.ended_at ?? run.started_at,
      );
    }
    writeFileSync(marker, `${digest}\n`, { mode: 0o600, flag: "wx" });
    return runs.length;
  } finally {
    database.close();
  }
}
