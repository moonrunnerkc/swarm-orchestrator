export type StopReason =
  | "completed"
  | "max-steps"
  | "max-tokens"
  | "max-wall-time"
  | "interrupted"
  | "model-error"
  /**
   * The runtime answered with neither text nor a tool call. Kept apart from "completed"
   * because a turn carrying nothing is not the model reporting it is done: a local runtime
   * that buffers a partial tool call and never flushes it returns exactly this, and reading
   * it as a completion turns the runtime dropping output into the model giving up.
   */
  | "empty-response"
  /**
   * The runtime was cut off at the output-token cap having emitted neither text nor a tool
   * call, which is what a reasoning model does when it spends the whole budget thinking. Kept
   * apart from "empty-response" because the two want different things done about them: an
   * empty turn is a runtime dropping output, and this is the model being given less room than
   * it needed. Reading a truncation as an empty response hides the one number that explains it.
   */
  | "output-cap";

export interface LoopBudget {
  readonly maxSteps: number;
  readonly maxTokens: number;
  readonly maxWallTimeMs: number;
}

interface LoopProgress {
  readonly steps: number;
  readonly tokensUsed: number;
  readonly elapsedMs: number;
  readonly interrupted: boolean;
}

/**
 * The reason the loop must stop before spending another model call, or null to continue.
 * A user interrupt outranks every budget so a stop is never reported as an exhausted limit.
 */
export function findExhaustedLimit(progress: LoopProgress, budget: LoopBudget): StopReason | null {
  if (progress.interrupted) {
    return "interrupted";
  }
  if (progress.steps >= budget.maxSteps) {
    return "max-steps";
  }
  if (progress.tokensUsed >= budget.maxTokens) {
    return "max-tokens";
  }
  if (progress.elapsedMs >= budget.maxWallTimeMs) {
    return "max-wall-time";
  }
  return null;
}
