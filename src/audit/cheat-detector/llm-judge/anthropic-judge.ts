// Anthropic Haiku judge for the no-op-fix detector. Lazy-imports the
// SDK so a default (judge-off) `swarm audit` still works when the
// package isn't present at runtime.
//
// The client is injectable. Tests inject a stub; production wiring
// constructs a real `Anthropic` instance against `ANTHROPIC_API_KEY`.

import Anthropic from '@anthropic-ai/sdk';
import type { JudgeAnswer, JudgeClient } from './types';

export interface AnthropicJudgeOptions {
  apiKey?: string;
  /** Inject a pre-built client (test seam). */
  client?: Anthropic;
  /** Override max output tokens. Default 128. */
  maxTokens?: number;
}

export class AnthropicJudge implements JudgeClient {
  private readonly client: Anthropic;
  private readonly maxTokens: number;

  constructor(options: AnthropicJudgeOptions = {}) {
    this.client =
      options.client ??
      new Anthropic({
        apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
      });
    this.maxTokens = options.maxTokens ?? 128;
  }

  async ask(prompt: { system: string; user: string; modelId: string }): Promise<{
    raw: string;
    answer: JudgeAnswer;
    reason?: string;
  }> {
    const response = await this.client.messages.create({
      model: prompt.modelId,
      max_tokens: this.maxTokens,
      temperature: 0,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
    });
    const raw = extractTextContent(response);
    const parsed = parseJudgeReply(raw);
    const out: { raw: string; answer: JudgeAnswer; reason?: string } = {
      raw,
      answer: parsed.answer,
    };
    if (parsed.reason !== undefined) out.reason = parsed.reason;
    return out;
  }
}

interface AnthropicTextBlock {
  type: string;
  text?: string;
}

interface AnthropicResponse {
  content?: AnthropicTextBlock[];
}

function extractTextContent(response: unknown): string {
  const r = response as AnthropicResponse;
  if (r.content === undefined) return '';
  const parts: string[] = [];
  for (const block of r.content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('').trim();
}

/**
 * Strict parser. We accept exactly two shapes:
 *
 *   "YES <one-sentence reason>"
 *   "NO <one-sentence reason>"
 *
 * The leading token is case-insensitive. Anything else is treated as
 * malformed and returned with answer `'unavailable'` so the caller can
 * fall back to deterministic-only behavior.
 */
export function parseJudgeReply(raw: string): { answer: JudgeAnswer; reason?: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { answer: 'unavailable' };
  const match = /^(YES|NO)\b[\s:.,-]*([\s\S]*)$/iu.exec(trimmed);
  if (match === null) return { answer: 'unavailable' };
  const tag = match[1]?.toUpperCase();
  const reasonRaw = (match[2] ?? '').trim();
  if (tag !== 'YES' && tag !== 'NO') return { answer: 'unavailable' };
  const answer: JudgeAnswer = tag === 'YES' ? 'yes' : 'no';
  const out: { answer: JudgeAnswer; reason?: string } = { answer };
  if (reasonRaw.length > 0) out.reason = reasonRaw;
  return out;
}

export const JUDGE_SYSTEM_PROMPT =
  'You are a strict code-audit assistant. ' +
  'You will be given a PR title and a unified diff. Determine whether ' +
  'the changed non-test code plausibly affects the code path the PR ' +
  'title claims to fix. ' +
  'Respond with exactly one line: either "YES <one-sentence reason>" ' +
  'or "NO <one-sentence reason>". No other text.';

export function buildJudgeUserPrompt(prTitle: string, unifiedDiff: string): string {
  return [
    `PR title: ${prTitle}`,
    '',
    'Question: The PR title claims X is fixed. Does any added or modified ' +
      'non-test code plausibly affect the code path X exercises? Reply YES ' +
      'or NO followed by one sentence of reasoning.',
    '',
    'Unified diff:',
    '```diff',
    unifiedDiff,
    '```',
  ].join('\n');
}
