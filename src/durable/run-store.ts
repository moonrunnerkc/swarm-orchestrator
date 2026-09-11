import { z } from "zod";
import { digestOfBytes } from "../evidence/canonical-json.ts";
import { openRunJournal } from "./run-journal.ts";

export type RunState = "running" | "finished" | "aborted" | "interrupted";
export type StepState = "in-flight" | "done" | "failed" | "interrupted";

export interface StoredRun {
  readonly runId: string;
  readonly specDigest: string;
  readonly task: string;
  readonly state: RunState;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly detail: string | null;
}

export interface StoredStep {
  readonly runId: string;
  readonly stepId: string;
  readonly kind: string;
  readonly idempotencyKey: string;
  readonly attempt: number;
  readonly state: StepState;
  readonly resultDigest: string | null;
  readonly detail: string | null;
}

export interface StoredLease {
  readonly runId: string;
  readonly path: string;
  readonly holder: string;
  readonly heldAt: number;
}

export interface Interrupted {
  readonly steps: readonly StoredStep[];
  readonly leases: readonly StoredLease[];
}

export interface Repaired {
  readonly releasedLeases: number;
  readonly reopenedSteps: number;
}

export interface RunStore {
  startRun(input: { runId: string; specDigest: string; task: string; startedAt: number }): void;
  finishRun(runId: string, at: number): void;
  abortRun(runId: string, reason: string, at: number): void;
  listRuns(): readonly StoredRun[];
  run(runId: string): StoredRun | null;

  beginStep(input: {
    runId: string;
    stepId: string;
    kind: string;
    idempotencyKey: string;
    at: number;
  }): void;
  finishStep(input: { runId: string; stepId: string; resultDigest: string; at: number }): void;
  failStep(input: { runId: string; stepId: string; reason: string; at: number }): void;
  steps(runId: string): readonly StoredStep[];
  /** The committed result for this work, or null where it was never completed. */
  alreadyDone(runId: string, idempotencyKey: string): StoredStep | null;

  acquireLease(input: { runId: string; path: string; holder: string; at: number }): boolean;
  releaseLease(input: { runId: string; path: string; holder: string }): void;
  leases(runId: string): readonly StoredLease[];

  setBudget(input: { runId: string; tokens: number }): void;
  reserve(input: { runId: string; stepId: string; tokens: number }): boolean;
  remainingTokens(runId: string): number | null;

  recordApproval(input: { runId: string; subject: string; granted: boolean; at: number }): void;
  approvalFor(runId: string, subject: string): { readonly granted: boolean } | null;

  interrupted(runId: string): Interrupted;
  repair(runId: string, at: number): Repaired;

  close(): void;
}

const runSchema = z.object({
  runId: z.string(),
  specDigest: z.string(),
  task: z.string(),
  state: z.enum(["running", "finished", "aborted", "interrupted"]),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  detail: z.string().nullable(),
});
const stepSchema = z.object({
  runId: z.string(),
  stepId: z.string(),
  kind: z.string(),
  operationDigest: z.string(),
  attempt: z.number().int(),
  state: z.enum(["in-flight", "done", "failed", "interrupted"]),
  resultDigest: z.string().nullable(),
  detail: z.string().nullable(),
});
const leaseSchema = z.object({
  runId: z.string(),
  path: z.string(),
  holder: z.string(),
  heldAt: z.number(),
});
const projectionSchema = z.object({
  runs: z.record(z.string(), runSchema),
  steps: z.record(z.string(), stepSchema),
  leases: z.record(z.string(), leaseSchema),
  budgets: z.record(z.string(), z.number()),
  reservations: z.record(z.string(), z.object({ runId: z.string(), tokens: z.number() })),
  approvals: z.record(z.string(), z.object({ granted: z.boolean() })),
});
type Projection = z.infer<typeof projectionSchema>;
const key = (...parts: string[]) => JSON.stringify(parts);
const identity = (value: string) =>
  /^sha256:[0-9a-f]{64}$/.test(value) ? value : digestOfBytes(value);
const exposedStep = (step: z.infer<typeof stepSchema>): StoredStep => ({
  ...step,
  idempotencyKey: step.operationDigest,
});

export function openRunStore(path: string): RunStore {
  const journal = openRunJournal(
    path,
    (): Projection => ({
      runs: {},
      steps: {},
      leases: {},
      budgets: {},
      reservations: {},
      approvals: {},
    }),
    (input) => projectionSchema.parse(input),
  );
  const requireRun = (projection: Projection, runId: string) => {
    const run = projection.runs[runId];
    if (run === undefined) throw new Error(`no run named ${runId} is stored here`);
    return run;
  };
  return {
    startRun: (input) =>
      journal.update("run-started", (projection) => {
        projection.runs[input.runId] = { ...input, state: "running", endedAt: null, detail: null };
      }),
    finishRun: (runId, at) =>
      journal.update("run-finished", (projection) => {
        Object.assign(requireRun(projection, runId), { state: "finished", endedAt: at });
      }),
    abortRun: (runId, reason, at) =>
      journal.update("run-aborted", (projection) => {
        Object.assign(requireRun(projection, runId), {
          state: "aborted",
          endedAt: at,
          detail: reason,
        });
      }),
    listRuns: () =>
      Object.values(journal.read().runs).sort((left, right) => right.startedAt - left.startedAt),
    run: (runId) => journal.read().runs[runId] ?? null,
    beginStep: (input) =>
      journal.update("step-intent", (projection) => {
        if (requireRun(projection, input.runId).state === "aborted")
          throw new Error(`run ${input.runId} was aborted and accepts no new work`);
        const id = key(input.runId, input.stepId);
        projection.steps[id] = {
          runId: input.runId,
          stepId: input.stepId,
          kind: input.kind,
          operationDigest: identity(input.idempotencyKey),
          attempt: (projection.steps[id]?.attempt ?? 0) + 1,
          state: "in-flight",
          resultDigest: null,
          detail: null,
        };
      }),
    finishStep: (input) =>
      journal.update("step-completed", (projection) => {
        const step = projection.steps[key(input.runId, input.stepId)];
        if (step === undefined) throw new Error(`step ${input.stepId} has no recorded intent`);
        Object.assign(step, { state: "done", resultDigest: input.resultDigest });
      }),
    failStep: (input) =>
      journal.update("step-failed", (projection) => {
        const step = projection.steps[key(input.runId, input.stepId)];
        if (step === undefined) throw new Error(`step ${input.stepId} has no recorded intent`);
        Object.assign(step, { state: "failed", detail: input.reason });
      }),
    steps: (runId) =>
      Object.values(journal.read().steps)
        .filter((step) => step.runId === runId)
        .sort((left, right) => left.stepId.localeCompare(right.stepId))
        .map(exposedStep),
    alreadyDone: (runId, idempotencyKey) => {
      const found = Object.values(journal.read().steps).find(
        (step) =>
          step.runId === runId &&
          step.operationDigest === identity(idempotencyKey) &&
          step.state === "done",
      );
      return found === undefined ? null : exposedStep(found);
    },
    acquireLease: (input) =>
      journal.update("lease-acquired", (projection) => {
        const id = key(input.runId, input.path);
        const held = projection.leases[id];
        if (held !== undefined) return held.holder === input.holder;
        projection.leases[id] = {
          runId: input.runId,
          path: input.path,
          holder: input.holder,
          heldAt: input.at,
        };
        return true;
      }),
    releaseLease: (input) =>
      journal.update("lease-released", (projection) => {
        const id = key(input.runId, input.path);
        if (projection.leases[id]?.holder === input.holder) delete projection.leases[id];
      }),
    leases: (runId) =>
      Object.values(journal.read().leases)
        .filter((lease) => lease.runId === runId)
        .sort((left, right) => left.path.localeCompare(right.path)),
    setBudget: (input) =>
      journal.update("budget-set", (projection) => {
        projection.budgets[input.runId] = input.tokens;
      }),
    reserve: (input) =>
      journal.update("budget-reserved", (projection) => {
        const budget = projection.budgets[input.runId];
        const id = key(input.runId, input.stepId);
        const spent = Object.entries(projection.reservations)
          .filter(([stored, reservation]) => stored !== id && reservation.runId === input.runId)
          .reduce((sum, [, reservation]) => sum + reservation.tokens, 0);
        if (budget !== undefined && input.tokens > budget - spent) return false;
        projection.reservations[id] = { runId: input.runId, tokens: input.tokens };
        return true;
      }),
    remainingTokens: (runId) => {
      const projection = journal.read();
      const budget = projection.budgets[runId];
      return budget === undefined
        ? null
        : budget -
            Object.values(projection.reservations)
              .filter((reservation) => reservation.runId === runId)
              .reduce((sum, reservation) => sum + reservation.tokens, 0);
    },
    recordApproval: (input) =>
      journal.update("approval-recorded", (projection) => {
        projection.approvals[key(input.runId, input.subject)] = { granted: input.granted };
      }),
    approvalFor: (runId, subject) => journal.read().approvals[key(runId, subject)] ?? null,
    interrupted(runId) {
      const steps = this.steps(runId).filter((step) => step.state === "in-flight");
      const holders = new Set(steps.map((step) => step.stepId));
      return { steps, leases: this.leases(runId).filter((lease) => holders.has(lease.holder)) };
    },
    repair: (runId, _at) =>
      journal.update("interruption-reconciled", (projection) => {
        const steps = Object.values(projection.steps).filter(
          (step) => step.runId === runId && step.state === "in-flight",
        );
        const holders = new Set(steps.map((step) => step.stepId));
        let releasedLeases = 0;
        for (const [id, lease] of Object.entries(projection.leases)) {
          if (lease.runId === runId && holders.has(lease.holder)) {
            delete projection.leases[id];
            releasedLeases += 1;
          }
        }
        for (const step of steps) step.state = "interrupted";
        const run = requireRun(projection, runId);
        if (steps.length > 0 && run.state === "running") run.state = "interrupted";
        return { releasedLeases, reopenedSteps: steps.length };
      }),
    close: () => {},
  };
}
