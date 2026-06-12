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
  buildPrimaryPrompt,
  CONFIRM_SYSTEM_PROMPT,
  JUDGE_SYSTEM_PROMPT,
  parseConfirmCategory,
  parsePrimaryCategory,
  primarySystemPrompt,
} from './anthropic-judge';
import { LocalJudge, localJudgeModelId } from './local-judge';
import { OllamaJudge, ollamaJudgeModelId } from './ollama-judge';
import {
  computeJudgeCacheKey,
  readCachedAnswer,
  writeCachedAnswer,
} from './cache';
import { chunkUnifiedDiff } from '../diff-chunker';
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

/** Resolve the production Anthropic judge model id. Defaults to the
 *  pinned snapshot; `SWARM_JUDGE_MODEL` overrides without a code change
 *  so an operator can move past a deprecation announcement without
 *  shipping a new build. The model id folds into the cache key, so an
 *  override never collides with cached answers from a prior model. */
function resolveAnthropicModelId(opts: AskJudgeOptions): string {
  if (opts.modelId !== undefined) return opts.modelId;
  const override = process.env.SWARM_JUDGE_MODEL;
  if (override !== undefined && override.trim().length > 0) return override.trim();
  return PINNED_JUDGE_MODEL_ID;
}

/** Resolve the judge provider. `SWARM_JUDGE_PROVIDER=local` points the
 *  judge at a free OpenAI-compatible server and
 *  `SWARM_JUDGE_PROVIDER=ollama` at Ollama's native /api/chat (the /v1
 *  bridge cannot disable a thinking model's reasoning, so local and
 *  ollama are distinct providers); anything else keeps the pinned
 *  Anthropic Haiku judge. The model id is folded into the cache key, so
 *  answers from different providers never collide. */
function resolveJudgeProvider(opts: AskJudgeOptions): { client: JudgeClient; modelId: string } {
  if (opts.client !== undefined) return { client: opts.client, modelId: resolveAnthropicModelId(opts) };
  const provider = (process.env.SWARM_JUDGE_PROVIDER ?? '').toLowerCase();
  if (provider === 'local') {
    return { client: new LocalJudge(), modelId: opts.modelId ?? localJudgeModelId() };
  }
  if (provider === 'ollama') {
    return { client: new OllamaJudge(), modelId: opts.modelId ?? ollamaJudgeModelId() };
  }
  return { client: new AnthropicJudge(), modelId: resolveAnthropicModelId(opts) };
}

export async function askJudge(opts: AskJudgeOptions): Promise<JudgeResult> {
  const provider = resolveJudgeProvider(opts);
  const resolvedOpts: AskJudgeOptions = { ...opts, client: provider.client };
  const modelId = provider.modelId;
  // Hunk-aware chunking. A diff over the judge's budget used to be
  // head-truncated, hiding any defect in the tail. Instead split it into
  // chunks that each stay under the budget and judge every chunk; a YES on
  // any chunk is a YES overall. Diffs under the budget are a single chunk,
  // so the common path and its cache keys are unchanged.
  const chunks = chunkUnifiedDiff(opts.request.unifiedDiff, MAX_JUDGE_DIFF_CHARS);
  const fullIds = computeJudgeCacheKey({
    diff: opts.request.unifiedDiff,
    title: opts.request.prTitle,
    modelId,
    detector: opts.request.detector,
  });

  const outcomes: ChunkOutcome[] = [];
  for (const chunk of chunks) {
    outcomes.push(await judgeChunk(resolvedOpts, chunk, modelId));
  }
  const merged = mergeOutcomes(outcomes);

  const result: JudgeResult = {
    answer: merged.answer,
    modelId,
    cacheHit: merged.allCached,
    diffSha: fullIds.diffSha,
    titleSha: fullIds.titleSha,
  };
  if (merged.reason !== undefined) result.reason = merged.reason;
  recordLedger(opts.ledger, opts.request.detector, result);
  return result;
}

/** Short, stable identifier of a judge call's prompt inputs, from the title
 *  and diff shas the ledger records. Shown in the PR comment so a reader can
 *  match the rendered verdict to the recorded input without leaking the diff. */
export function formatJudgePromptHash(titleSha: string, diffSha: string): string {
  return `t:${titleSha.slice(0, 8)}+d:${diffSha.slice(0, 8)}`;
}

interface ChunkOutcome {
  answer: JudgeResult['answer'];
  reason?: string;
  cacheHit: boolean;
}

function buildJudgePrompts(
  detector: string,
  prTitle: string,
  diff: string,
): { system: string; user: string } {
  const primary = parsePrimaryCategory(detector);
  const confirm = primary === undefined ? parseConfirmCategory(detector) : undefined;
  return {
    system:
      primary !== undefined
        ? primarySystemPrompt()
        : confirm === undefined
          ? JUDGE_SYSTEM_PROMPT
          : CONFIRM_SYSTEM_PROMPT,
    user:
      primary !== undefined
        ? buildPrimaryPrompt(primary, prTitle, diff)
        : confirm === undefined
          ? buildJudgeUserPrompt(prTitle, diff)
          : buildConfirmationPrompt(confirm, prTitle, diff),
  };
}

async function judgeChunk(
  opts: AskJudgeOptions,
  chunkDiff: string,
  modelId: string,
): Promise<ChunkOutcome> {
  const { cacheKey, diffSha, titleSha } = computeJudgeCacheKey({
    diff: chunkDiff,
    title: opts.request.prTitle,
    modelId,
    detector: opts.request.detector,
  });
  const cached = readCachedAnswer(opts.repoRoot, cacheKey);
  if (cached !== undefined) {
    const out: ChunkOutcome = { answer: cached.answer, cacheHit: true };
    if (cached.reason !== undefined) out.reason = cached.reason;
    return out;
  }
  const liveAllowed = opts.allowLiveCall ?? true;
  if (!liveAllowed || !hasCredentials(opts)) {
    return { answer: 'unavailable', cacheHit: false };
  }
  const client: JudgeClient = opts.client ?? new AnthropicJudge();
  let raw: { answer: JudgeResult['answer']; reason?: string };
  try {
    const { system, user } = buildJudgePrompts(opts.request.detector, opts.request.prTitle, chunkDiff);
    raw = await client.ask({ system, user, modelId });
  } catch (err) {
    logger.warn(`llm-judge call failed: ${err instanceof Error ? err.message : String(err)}`);
    return { answer: 'unavailable', cacheHit: false };
  }
  if (raw.answer !== 'unavailable') {
    const entry: Parameters<typeof writeCachedAnswer>[2] = {
      diffSha,
      titleSha,
      modelId,
      answer: raw.answer,
    };
    if (raw.reason !== undefined) entry.reason = raw.reason;
    writeCachedAnswer(opts.repoRoot, cacheKey, entry);
  }
  const out: ChunkOutcome = { answer: raw.answer, cacheHit: false };
  if (raw.reason !== undefined) out.reason = raw.reason;
  return out;
}

/** A YES on any chunk wins (the cheat is somewhere in the diff); otherwise
 *  a NO if any chunk could judge; unavailable only when no chunk could. */
function mergeOutcomes(outcomes: ChunkOutcome[]): {
  answer: JudgeResult['answer'];
  reason?: string;
  allCached: boolean;
} {
  const allCached = outcomes.every((o) => o.cacheHit);
  const yes = outcomes.find((o) => o.answer === 'yes');
  if (yes !== undefined) {
    return yes.reason !== undefined ? { answer: 'yes', reason: yes.reason, allCached } : { answer: 'yes', allCached };
  }
  const no = outcomes.find((o) => o.answer === 'no');
  if (no !== undefined) {
    return no.reason !== undefined ? { answer: 'no', reason: no.reason, allCached } : { answer: 'no', allCached };
  }
  return { answer: 'unavailable', allCached };
}

function hasCredentials(opts: AskJudgeOptions): boolean {
  if (opts.client !== undefined) return true;
  return (process.env.ANTHROPIC_API_KEY ?? '').length > 0;
}

// ~120k chars is well under Haiku's 200k-token ceiling once the prompt
// scaffold is added. It is the per-chunk budget for the hunk-aware
// chunker, and is exported so the benchmark harnesses size their context
// the same way. `SWARM_JUDGE_MAX_DIFF_CHARS` overrides it for judges
// with smaller context windows: chars-per-token collapses toward 1 on
// base64/SVG-heavy diffs, so a 120k-char chunk can overflow a 131k-token
// local model and make the server truncate the prompt (front-first,
// eating the question) where Haiku would still have headroom.
function resolveMaxJudgeDiffChars(): number {
  const raw = process.env.SWARM_JUDGE_MAX_DIFF_CHARS;
  if (raw === undefined || raw.trim().length === 0) return 120_000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1_000) {
    logger.warn(`ignoring SWARM_JUDGE_MAX_DIFF_CHARS=${raw} (need a number >= 1000)`);
    return 120_000;
  }
  return Math.floor(n);
}
export const MAX_JUDGE_DIFF_CHARS = resolveMaxJudgeDiffChars();

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
