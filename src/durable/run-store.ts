import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ownerOnlyDirectory, ownerOnlyFile } from "../evidence/store-mode.ts";

/**
 * What a run leaves behind that survives the process.
 *
 * The ledger is the record of what happened and is append-only by design, which makes it the
 * wrong thing to ask "what is still owed". A resumed run needs mutable state: which activities
 * were dispatched and never came back, which files are held, what budget is spent, what a person
 * already approved. Keeping that only in memory means a killed process leaves worktrees, leases
 * and branches behind and no way to tell what it had already done from what it had only started.
 *
 * Intent is written before the effect, so a crash between the two is visible rather than
 * invisible: a step in flight with no result is exactly the thing a resume has to decide about.
 * Idempotency is keyed on the work, so replaying a resumed run does not repeat an effect it
 * already committed.
 *
 * SQLite from the standard library, in WAL mode, because the alternative is a dependency for a
 * transactional key-value store this already has.
 */
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

export function openRunStore(path: string): RunStore {
  mkdirSync(dirname(path), { recursive: true, mode: ownerOnlyDirectory });
  const db = new DatabaseSync(path);
  // WAL so a reader (`swarm list-runs`) never blocks a writer (the run itself).
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      spec_digest TEXT NOT NULL,
      task TEXT NOT NULL,
      state TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      detail TEXT,
      token_budget INTEGER
    );
    CREATE TABLE IF NOT EXISTS steps (
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      step_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      state TEXT NOT NULL,
      result_digest TEXT,
      detail TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (run_id, step_id)
    );
    CREATE TABLE IF NOT EXISTS leases (
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      path TEXT NOT NULL,
      holder TEXT NOT NULL,
      held_at INTEGER NOT NULL,
      PRIMARY KEY (run_id, path)
    );
    CREATE TABLE IF NOT EXISTS reservations (
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      step_id TEXT NOT NULL,
      tokens INTEGER NOT NULL,
      PRIMARY KEY (run_id, step_id)
    );
    CREATE TABLE IF NOT EXISTS approvals (
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      subject TEXT NOT NULL,
      granted INTEGER NOT NULL,
      at INTEGER NOT NULL,
      PRIMARY KEY (run_id, subject)
    );
  `);
  // Same reasoning as the session store: this holds task text and step results.
  try {
    chmodSync(path, ownerOnlyFile);
  } catch {
    // A filesystem that will not carry the mode is not a reason to refuse to record.
  }

  const requireRunnable = (runId: string): void => {
    const state = db.prepare("SELECT state FROM runs WHERE run_id = ?").get(runId) as
      | { state: string }
      | undefined;
    if (state === undefined) {
      throw new Error(`no run named ${runId} is stored here`);
    }
    if (state.state === "aborted") {
      throw new Error(
        `run ${runId} was aborted, so it accepts no new work. Start another run, or repair ` +
          "this one first if you meant to take it up again.",
      );
    }
  };

  const readStep = (row: Record<string, unknown>): StoredStep => ({
    runId: String(row.run_id),
    stepId: String(row.step_id),
    kind: String(row.kind),
    idempotencyKey: String(row.idempotency_key),
    attempt: Number(row.attempt),
    state: String(row.state) as StepState,
    resultDigest: row.result_digest === null ? null : String(row.result_digest),
    detail: row.detail === null ? null : String(row.detail),
  });

  return {
    startRun(input) {
      db.prepare(
        "INSERT OR REPLACE INTO runs (run_id, spec_digest, task, state, started_at) VALUES (?, ?, ?, 'running', ?)",
      ).run(input.runId, input.specDigest, input.task, input.startedAt);
    },

    finishRun(runId, at) {
      db.prepare("UPDATE runs SET state = 'finished', ended_at = ? WHERE run_id = ?").run(
        at,
        runId,
      );
    },

    abortRun(runId, reason, at) {
      db.prepare(
        "UPDATE runs SET state = 'aborted', ended_at = ?, detail = ? WHERE run_id = ?",
      ).run(at, reason, runId);
    },

    listRuns() {
      return (
        db.prepare("SELECT * FROM runs ORDER BY started_at DESC").all() as Record<string, unknown>[]
      ).map((row) => ({
        runId: String(row.run_id),
        specDigest: String(row.spec_digest),
        task: String(row.task),
        state: String(row.state) as RunState,
        startedAt: Number(row.started_at),
        endedAt: row.ended_at === null ? null : Number(row.ended_at),
        detail: row.detail === null ? null : String(row.detail),
      }));
    },

    run(runId) {
      return this.listRuns().find((stored) => stored.runId === runId) ?? null;
    },

    beginStep(input) {
      requireRunnable(input.runId);
      const existing = db
        .prepare("SELECT attempt FROM steps WHERE run_id = ? AND step_id = ?")
        .get(input.runId, input.stepId) as { attempt: number } | undefined;
      // Intent before effect: the row says in-flight with no result, which is exactly what a
      // resume has to decide about. A second attempt counts rather than replacing the first.
      db.prepare(
        `INSERT INTO steps (run_id, step_id, kind, idempotency_key, attempt, state, updated_at)
         VALUES (?, ?, ?, ?, ?, 'in-flight', ?)
         ON CONFLICT(run_id, step_id) DO UPDATE SET
           attempt = excluded.attempt, state = 'in-flight', result_digest = NULL,
           detail = NULL, updated_at = excluded.updated_at`,
      ).run(
        input.runId,
        input.stepId,
        input.kind,
        input.idempotencyKey,
        (existing?.attempt ?? 0) + 1,
        input.at,
      );
    },

    finishStep(input) {
      db.prepare(
        "UPDATE steps SET state = 'done', result_digest = ?, updated_at = ? WHERE run_id = ? AND step_id = ?",
      ).run(input.resultDigest, input.at, input.runId, input.stepId);
    },

    failStep(input) {
      db.prepare(
        "UPDATE steps SET state = 'failed', detail = ?, updated_at = ? WHERE run_id = ? AND step_id = ?",
      ).run(input.reason, input.at, input.runId, input.stepId);
    },

    steps(runId) {
      return (
        db.prepare("SELECT * FROM steps WHERE run_id = ? ORDER BY step_id").all(runId) as Record<
          string,
          unknown
        >[]
      ).map(readStep);
    },

    alreadyDone(runId, idempotencyKey) {
      const row = db
        .prepare("SELECT * FROM steps WHERE run_id = ? AND idempotency_key = ? AND state = 'done'")
        .get(runId, idempotencyKey) as Record<string, unknown> | undefined;
      return row === undefined ? null : readStep(row);
    },

    acquireLease(input) {
      const held = db
        .prepare("SELECT holder FROM leases WHERE run_id = ? AND path = ?")
        .get(input.runId, input.path) as { holder: string } | undefined;
      if (held !== undefined) {
        return held.holder === input.holder;
      }
      db.prepare("INSERT INTO leases (run_id, path, holder, held_at) VALUES (?, ?, ?, ?)").run(
        input.runId,
        input.path,
        input.holder,
        input.at,
      );
      return true;
    },

    releaseLease(input) {
      db.prepare("DELETE FROM leases WHERE run_id = ? AND path = ? AND holder = ?").run(
        input.runId,
        input.path,
        input.holder,
      );
    },

    leases(runId) {
      return (
        db.prepare("SELECT * FROM leases WHERE run_id = ? ORDER BY path").all(runId) as Record<
          string,
          unknown
        >[]
      ).map((row) => ({
        runId: String(row.run_id),
        path: String(row.path),
        holder: String(row.holder),
        heldAt: Number(row.held_at),
      }));
    },

    setBudget(input) {
      db.prepare("UPDATE runs SET token_budget = ? WHERE run_id = ?").run(
        input.tokens,
        input.runId,
      );
    },

    reserve(input) {
      const remaining = this.remainingTokens(input.runId);
      // Reserved before dispatch, never after: work that cannot fit is not started, which is
      // what stops a budget being discovered as exceeded once it already has been.
      if (remaining !== null && input.tokens > remaining) {
        return false;
      }
      db.prepare(
        "INSERT OR REPLACE INTO reservations (run_id, step_id, tokens) VALUES (?, ?, ?)",
      ).run(input.runId, input.stepId, input.tokens);
      return true;
    },

    remainingTokens(runId) {
      const budget = db.prepare("SELECT token_budget FROM runs WHERE run_id = ?").get(runId) as
        | { token_budget: number | null }
        | undefined;
      if (budget?.token_budget === null || budget === undefined) {
        return null;
      }
      const spent = db
        .prepare("SELECT COALESCE(SUM(tokens), 0) AS total FROM reservations WHERE run_id = ?")
        .get(runId) as { total: number };
      return budget.token_budget - spent.total;
    },

    recordApproval(input) {
      db.prepare(
        "INSERT OR REPLACE INTO approvals (run_id, subject, granted, at) VALUES (?, ?, ?, ?)",
      ).run(input.runId, input.subject, input.granted ? 1 : 0, input.at);
    },

    approvalFor(runId, subject) {
      const row = db
        .prepare("SELECT granted FROM approvals WHERE run_id = ? AND subject = ?")
        .get(runId, subject) as { granted: number } | undefined;
      return row === undefined ? null : { granted: row.granted === 1 };
    },

    interrupted(runId) {
      const steps = (
        db
          .prepare("SELECT * FROM steps WHERE run_id = ? AND state = 'in-flight' ORDER BY step_id")
          .all(runId) as Record<string, unknown>[]
      ).map(readStep);
      const holders = new Set(steps.map((step) => step.stepId));
      return {
        steps,
        leases: this.leases(runId).filter((lease) => holders.has(lease.holder)),
      };
    },

    repair(runId, at) {
      const stranded = this.interrupted(runId);
      for (const lease of stranded.leases) {
        this.releaseLease({ runId, path: lease.path, holder: lease.holder });
      }
      for (const step of stranded.steps) {
        db.prepare(
          "UPDATE steps SET state = 'interrupted', updated_at = ? WHERE run_id = ? AND step_id = ?",
        ).run(at, runId, step.stepId);
      }
      if (stranded.steps.length > 0) {
        db.prepare(
          "UPDATE runs SET state = 'interrupted' WHERE run_id = ? AND state = 'running'",
        ).run(runId);
      }
      return { releasedLeases: stranded.leases.length, reopenedSteps: stranded.steps.length };
    },

    close() {
      db.close();
    },
  };
}
