// Gated LLM judge orchestrator. Per call: build cache key, check the
// content-addressed cache, ask the client only on miss, persist the
// answer, write one `llm-judge-result` ledger entry (cache hit or
// live). Never throws: a missing key, a network failure, or a
// malformed reply collapses to `answer: 'unavailable'` so the audit
// keeps running on deterministic signals alone.

import { getLogger } from '../../../logger';
import type { JudgeLedgerSink } from '../../types';
import {
  AnthropicJudge,
  buildConfirmationPrompt,
  buildJudgeUserPrompt,
  CONFIRM_SYSTEM_PROMPT,
  JUDGE_SYSTEM_PROMPT,
  parseConfirmCategory,
} from './anthropic-judge';
import {
  computeJudgeCacheKey,
  readCachedAnswer,
  writeCachedAnswer,
} from './cache';
import {
  PINNED_JUDGE_MODEL_ID,
  type JudgeClient,
  type JudgeRequest,
  type JudgeResult,
} from './types';

const logger = getLogger('audit:judge');

export interface AskJudgeOptions {
  repoRoot: string;
  request: JudgeRequest;
  ledger?: JudgeLedgerSink;
  /** Override the pinned model id. Tests only. */
  modelId?: string;
  /** Inject a client (tests, or a future local-model backend). */
  client?: JudgeClient;
  /** When false, the judge skips the live call even on cache miss and
   *  returns `'unavailable'`. Used to model "API key absent" in tests. */
  allowLiveCall?: boolean;
}

export async function askJudge(opts: AskJudgeOptions): Promise<JudgeResult> {
  const modelId = opts.modelId ?? PINNED_JUDGE_MODEL_ID;
  // Cap the diff before it reaches the model and the cache key. Haiku's
  // context is 200k tokens; lockfile regenerations and vendored trees
  // exceed it and the API rejects the whole call. Every caller that
  // sends a diff (the confirmation gate and the no-op-fix detector)
  // gets the cap from one place. The head of the diff is where flagged
  // hunks sit, and the cap is part of the cache key so replay matches.
  const diff = capDiffForJudge(opts.request.unifiedDiff);
  const { cacheKey, diffSha, titleSha } = computeJudgeCacheKey({
    diff,
    title: opts.request.prTitle,
    modelId,
    detector: opts.request.detector,
  });

  const cached = readCachedAnswer(opts.repoRoot, cacheKey);
  if (cached !== undefined) {
    const cachedResult: JudgeResult = {
      answer: cached.answer,
      modelId,
      cacheHit: true,
      diffSha,
      titleSha,
    };
    if (cached.reason !== undefined) cachedResult.reason = cached.reason;
    recordLedger(opts.ledger, opts.request.detector, cachedResult);
    return cachedResult;
  }

  const liveAllowed = opts.allowLiveCall ?? true;
  if (!liveAllowed || !hasCredentials(opts)) {
    const unavailable: JudgeResult = {
      answer: 'unavailable',
      modelId,
      cacheHit: false,
      diffSha,
      titleSha,
    };
    recordLedger(opts.ledger, opts.request.detector, unavailable);
    return unavailable;
  }

  const client: JudgeClient = opts.client ?? new AnthropicJudge();
  let raw: { answer: JudgeResult['answer']; reason?: string };
  try {
    const confirm = parseConfirmCategory(opts.request.detector);
    raw = await client.ask({
      system: confirm === undefined ? JUDGE_SYSTEM_PROMPT : CONFIRM_SYSTEM_PROMPT,
      user:
        confirm === undefined
          ? buildJudgeUserPrompt(opts.request.prTitle, diff)
          : buildConfirmationPrompt(confirm, opts.request.prTitle, diff),
      modelId,
    });
  } catch (err) {
    logger.warn(
      `llm-judge call failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    const failed: JudgeResult = {
      answer: 'unavailable',
      modelId,
      cacheHit: false,
      diffSha,
      titleSha,
    };
    recordLedger(opts.ledger, opts.request.detector, failed);
    return failed;
  }

  const result: JudgeResult = {
    answer: raw.answer,
    modelId,
    cacheHit: false,
    diffSha,
    titleSha,
  };
  if (raw.reason !== undefined) result.reason = raw.reason;

  if (result.answer !== 'unavailable') {
    const entry: Parameters<typeof writeCachedAnswer>[2] = {
      diffSha,
      titleSha,
      modelId,
      answer: result.answer,
    };
    if (result.reason !== undefined) entry.reason = result.reason;
    writeCachedAnswer(opts.repoRoot, cacheKey, entry);
  }
  recordLedger(opts.ledger, opts.request.detector, result);
  return result;
}

function hasCredentials(opts: AskJudgeOptions): boolean {
  if (opts.client !== undefined) return true;
  return (process.env.ANTHROPIC_API_KEY ?? '').length > 0;
}

// ~120k chars is well under Haiku's 200k-token ceiling once the prompt
// scaffold is added. Exported so callers can size their own context if
// they need to, but the cap is applied unconditionally inside askJudge.
export const MAX_JUDGE_DIFF_CHARS = 120_000;

function capDiffForJudge(diff: string): string {
  if (diff.length <= MAX_JUDGE_DIFF_CHARS) return diff;
  return (
    `${diff.slice(0, MAX_JUDGE_DIFF_CHARS)}\n` +
    `... [diff truncated at ${MAX_JUDGE_DIFF_CHARS} chars for the judge; ` +
    `${diff.length - MAX_JUDGE_DIFF_CHARS} more chars omitted]`
  );
}

function recordLedger(
  ledger: JudgeLedgerSink | undefined,
  detector: string,
  result: JudgeResult,
): void {
  if (ledger === undefined) return;
  const entry: import('../../types').JudgeLedgerEntry = {
    type: 'llm-judge-result',
    detector,
    modelId: result.modelId,
    cacheHit: result.cacheHit,
    diffSha: result.diffSha,
    titleSha: result.titleSha,
    answer: result.answer,
  };
  if (result.reason !== undefined) entry.reason = result.reason;
  ledger.appendJudgeEntry(entry);
}

export { PINNED_JUDGE_MODEL_ID } from './types';
export type { JudgeAnswer, JudgeRequest, JudgeResult, JudgeClient } from './types';
