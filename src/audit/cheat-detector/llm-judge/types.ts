// Shared types for the gated LLM judge. The judge is an opt-in
// secondary signal on detectors that benefit from it (currently
// `no-op-fix`). The default audit path runs without any of this; the
// judge fires only when `--enable-llm-judge` or
// `SWARM_AUDIT_LLM_JUDGE=1` is set, so the no-credentials default
// contract of `swarm audit` is preserved.

export type JudgeAnswer = 'yes' | 'no' | 'unavailable';

export interface JudgeRequest {
  detector: string;
  prTitle: string;
  unifiedDiff: string;
}

export interface JudgeResult {
  answer: JudgeAnswer;
  reason?: string;
  modelId: string;
  cacheHit: boolean;
  diffSha: string;
  titleSha: string;
}

export interface JudgeClient {
  /**
   * Send a YES/NO request to the underlying model. Implementations must
   * return `'unavailable'` rather than throwing when credentials are
   * missing or the API errors; callers rely on this to keep the audit
   * from crashing on a flaky third-party dependency.
   */
  ask(prompt: { system: string; user: string; modelId: string }): Promise<{
    raw: string;
    answer: JudgeAnswer;
    reason?: string;
  }>;
}

/** Pinned Haiku snapshot for the v10.3 judge. Bump only on a deliberate
 *  re-baseline, since cache entries are keyed against this id. */
export const PINNED_JUDGE_MODEL_ID = 'claude-haiku-4-5-20251001';
