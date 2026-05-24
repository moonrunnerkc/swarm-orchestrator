// Gated LLM judge orchestrator. Per call: build cache key, check the
// content-addressed cache, ask the client only on miss, persist the
// answer, write one `llm-judge-result` ledger entry (cache hit or
// live). Never throws: a missing key, a network failure, or a
// malformed reply collapses to `answer: 'unavailable'` so the audit
// keeps running on deterministic signals alone.

import { getLogger } from '../../../logger';
import type { JudgeLedgerSink } from '../../types';
import { AnthropicJudge, buildJudgeUserPrompt, JUDGE_SYSTEM_PROMPT } from './anthropic-judge';
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
  const { cacheKey, diffSha, titleSha } = computeJudgeCacheKey({
    diff: opts.request.unifiedDiff,
    title: opts.request.prTitle,
    modelId,
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
    raw = await client.ask({
      system: JUDGE_SYSTEM_PROMPT,
      user: buildJudgeUserPrompt(opts.request.prTitle, opts.request.unifiedDiff),
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
