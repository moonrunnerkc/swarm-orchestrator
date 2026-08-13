import type { StopReason } from "./termination.ts";

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
    };
