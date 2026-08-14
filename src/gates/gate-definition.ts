import type { GateStatus } from "../core/loop-events.ts";
import type { FileSetState } from "./file-set.ts";
import type { WorkspaceChanges, WorkspaceProbe } from "./workspace-changes.ts";

export type GateSeverity = "blocking" | "advisory";

/** Named numbers a gate measured. Flat keys, so a claim predicate can address one directly. */
export type GateMeasures = Readonly<Record<string, number>>;

/**
 * What running a gate produced, before anyone decided what it means. This is the shape the
 * ledger stores, and it is deliberately sufficient on its own: a reviewer holding the
 * record can rerun the parser over these bytes and arrive at the same verdict, which is
 * what keeps a gate result evidence rather than an assertion (invariant 1).
 */
export interface GateObservation {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  /** Why the gate could not run at all, or null when it ran. */
  readonly unavailable: string | null;
}

export interface GateReading {
  readonly status: GateStatus;
  readonly detail: string;
  readonly measures: GateMeasures;
}

/** The whole judgement step: bytes in, verdict and numbers out. No other input. */
export type GateParser = (observation: GateObservation) => GateReading;

export interface DiffBudget {
  readonly maxChangedFiles: number;
  readonly maxAddedLines: number;
}

export interface GateContext {
  readonly workspaceRoot: string;
  readonly changes: WorkspaceChanges;
  readonly fileSet: FileSetState;
  readonly budgets: DiffBudget;
  readonly probe: WorkspaceProbe;
}

/**
 * An inspection produces the same shape a command does, so the parser stays the only thing
 * that judges and the engine keeps one execution path for every gate.
 */
type GateInspection = (context: GateContext) => Promise<GateObservation>;

type GateSource =
  | { readonly kind: "command"; readonly command: string; readonly timeoutMs?: number }
  | { readonly kind: "inspection"; readonly inspect: GateInspection };

/**
 * A gate is data: what to run, how to read its output, and whether it blocks. The engine
 * never looks at an id to decide anything, so adding a gate is adding one of these
 * (invariant 6).
 */
export interface GateDefinition {
  readonly id: string;
  readonly title: string;
  readonly severity: GateSeverity;
  readonly source: GateSource;
  readonly parse: GateParser;
}

export interface CommandOptions {
  readonly cwd: string;
  readonly timeoutMs: number;
}

/** Injected so the engine's tests never depend on a real shell. */
export interface GateCommandRunner {
  run(command: string, options: CommandOptions): Promise<GateObservation>;
}

export const defaultGateTimeoutMs = 300_000;

export function observationFromJson(value: unknown, exitCode: number): GateObservation {
  return {
    exitCode,
    stdout: JSON.stringify(value, null, 2),
    stderr: "",
    durationMs: 0,
    unavailable: null,
  };
}

/** The one place a not-applicable observation is made, so it always reads the same way. */
export function unavailableObservation(reason: string): GateObservation {
  return { exitCode: 0, stdout: "", stderr: "", durationMs: 0, unavailable: reason };
}
