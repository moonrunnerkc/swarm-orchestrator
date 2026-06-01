// Local OpenAI-compatible judge. Talks to a server that speaks the
// `/v1/chat/completions` shape (LM Studio, llama.cpp server, rapid-mlx,
// vLLM, Ollama's OpenAI bridge). It exists so the audit's judge gate can
// run without a paid API: when the Anthropic judge has no credentials,
// the structural detectors run ungated and a real PR draws a wall of
// advisory findings; pointing the judge at a free local model restores
// the gate. Selected with `SWARM_JUDGE_PROVIDER=local`; the base URL and
// model come from `SWARM_JUDGE_BASE_URL` / `SWARM_JUDGE_MODEL` (or the
// RAPIDMLX_* equivalents), defaulting to http://localhost:8000.
//
// Like every JudgeClient it returns `'unavailable'` rather than throwing,
// so a down server degrades to deterministic-only behavior.

import type { JudgeAnswer, JudgeClient } from './types';
import { parseJudgeReply } from './anthropic-judge';

interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export interface LocalJudgeOptions {
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
}

export class LocalJudge implements JudgeClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: LocalJudgeOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.SWARM_JUDGE_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '');
    this.model = options.model ?? process.env.SWARM_JUDGE_MODEL ?? process.env.RAPIDMLX_MODEL ?? 'local-model';
    this.maxTokens = options.maxTokens ?? 128;
  }

  async ask(prompt: { system: string; user: string; modelId: string }): Promise<{
    raw: string;
    answer: JudgeAnswer;
    reason?: string;
  }> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          max_tokens: this.maxTokens,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
          // rapid-mlx and similar expose a thinking toggle; off for a terse
          // one-line YES/NO the strict parser can read.
          enable_thinking: false,
        }),
      });
      if (!res.ok) return { raw: '', answer: 'unavailable' };
      const json = (await res.json()) as OpenAiChatResponse;
      const raw = (json.choices?.[0]?.message?.content ?? '').trim();
      const parsed = parseJudgeReply(raw);
      const out: { raw: string; answer: JudgeAnswer; reason?: string } = { raw, answer: parsed.answer };
      if (parsed.reason !== undefined) out.reason = parsed.reason;
      return out;
    } catch {
      return { raw: '', answer: 'unavailable' };
    }
  }
}

/** The judge model id to fold into the cache key when the local provider
 *  is selected, so local-judged answers never collide with Haiku-judged
 *  ones in the committed cache. */
export function localJudgeModelId(): string {
  const model = process.env.SWARM_JUDGE_MODEL ?? process.env.RAPIDMLX_MODEL ?? 'local-model';
  return `local:${model}`;
}
