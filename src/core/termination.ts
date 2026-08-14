export type StopReason =
  | "completed"
  | "max-steps"
  | "max-tokens"
  | "max-wall-time"
  | "interrupted"
  | "model-error";

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
