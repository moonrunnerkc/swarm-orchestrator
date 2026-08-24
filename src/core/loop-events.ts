import type { StopReason } from "./termination.ts";

/**
 * What a gate run concluded. Declared here rather than in src/gates so the event channel
 * stays free of a dependency on the engine that fills it. "not-applicable" is a real
 * outcome and never a green one: a gate that could not run has proven nothing.
 */
export type GateStatus = "passed" | "failed" | "not-applicable";

/**
 * What the loop reports as it runs. The TUI renders from these alone, never from a
 * side channel, so every displayed line traces to something the harness observed.
 */
export type LoopEvent =
  | { readonly type: "plan"; readonly text: string }
  | { readonly type: "model-call"; readonly step: number; readonly modelId: string }
  | {
      readonly type: "model-error";
      readonly step: number;
      readonly message: string;
      readonly willRetry: boolean;
    }
  | {
      readonly type: "tool-call";
      readonly callId: string;
      readonly toolName: string;
      readonly input: unknown;
    }
  | {
      readonly type: "tool-outcome";
      readonly callId: string;
      readonly toolName: string;
      readonly failed: boolean;
      readonly output: string;
    }
  /** The model's account of its own work. `verified` is a literal false: model text can never render green (invariant 1). */
  | { readonly type: "claim"; readonly text: string; readonly verified: false }
  | {
      readonly type: "stopped";
      readonly reason: StopReason;
      readonly steps: number;
      readonly tokensUsed: number;
    }
  /** Emitted after the gate's ledger record is written, and carrying that record's digest. */
  | {
      readonly type: "gate";
      readonly gateId: string;
      readonly status: GateStatus;
      readonly blocking: boolean;
      readonly detail: string;
      readonly record: string;
    }
  | { readonly type: "attempt"; readonly attempt: number; readonly cap: number }
  | {
      readonly type: "ratchet";
      readonly attempt: number;
      readonly accepted: boolean;
      readonly detail: string;
      readonly record: string;
    }
  /**
   * How many files the settled cycle measured. Sent so the screen can say that a run changed
   * nothing, which is otherwise indistinguishable on it from a run whose gates all passed.
   */
  | { readonly type: "changes"; readonly changedFiles: number }
  | {
      readonly type: "escalated";
      readonly gateId: string;
      readonly detail: string;
      readonly attempts: number;
    };
