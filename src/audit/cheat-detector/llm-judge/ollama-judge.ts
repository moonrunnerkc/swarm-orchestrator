// Ollama judge. Talks to Ollama's native /api/chat (NOT its OpenAI
// /v1 bridge): thinking models like qwen3 only honor the think:false
// toggle on the native endpoint, and through /v1 they spend the whole
// token budget reasoning and return empty content, which the strict
// YES/NO parser collapses to 'unavailable'. Selected with
// `SWARM_JUDGE_PROVIDER=ollama`; base URL from `SWARM_JUDGE_BASE_URL`
// (or `OLLAMA_BASE_URL`), model from `SWARM_JUDGE_MODEL` (required:
// Ollama has no meaningful default model).
//
// Uses node:http with an explicit generous timeout instead of fetch:
// with stream:false Ollama sends headers only when generation
// completes, and a long prompt on a loaded machine can exceed fetch's
// fixed 300s header timeout. That timeout is how the first local-judge
// run silently lost most of its answers.
//
// Like every JudgeClient it returns 'unavailable' rather than throwing,
// so a down server degrades to deterministic-only behavior, but every
// failure path is logged: a judge that silently answers nothing looks
// identical to a judge that answered NO, and that hides false
// negatives.

import * as http from 'http';
import { getLogger } from '../../../logger';
import type { JudgeAnswer, JudgeClient } from './types';
import { parseJudgeReply } from './anthropic-judge';

const logger = getLogger('audit:judge:ollama');

interface OllamaChatResponse {
  message?: { content?: string };
}

export interface OllamaJudgeOptions {
  baseUrl?: string;
  model?: string;
  /** Per-call ceiling. Generous because a cold model load plus a long
   *  prompt can take minutes; default 10 minutes. */
  timeoutMs?: number;
  numPredict?: number;
}

export class OllamaJudge implements JudgeClient {
  private readonly baseUrl: string;
  private readonly model: string | undefined;
  private readonly timeoutMs: number;
  private readonly numPredict: number;

  constructor(options: OllamaJudgeOptions = {}) {
    this.baseUrl = (
      options.baseUrl ??
      process.env.SWARM_JUDGE_BASE_URL ??
      process.env.OLLAMA_BASE_URL ??
      'http://localhost:11434'
    ).replace(/\/$/, '');
    this.model = options.model ?? process.env.SWARM_JUDGE_MODEL;
    this.timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
    this.numPredict = options.numPredict ?? 256;
  }

  async ask(prompt: { system: string; user: string; modelId: string }): Promise<{
    raw: string;
    answer: JudgeAnswer;
    reason?: string;
  }> {
    if (this.model === undefined || this.model.length === 0) {
      logger.warn('ollama judge selected but SWARM_JUDGE_MODEL is not set; answering unavailable');
      return { raw: '', answer: 'unavailable' };
    }
    let body: string;
    try {
      body = await this.post(
        JSON.stringify({
          model: this.model,
          think: false,
          stream: false,
          options: { temperature: 0, num_predict: this.numPredict },
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
        }),
      );
    } catch (err) {
      logger.warn(
        `ollama judge call failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { raw: '', answer: 'unavailable' };
    }
    let raw: string;
    try {
      const json = JSON.parse(body) as OllamaChatResponse;
      raw = (json.message?.content ?? '').trim();
    } catch (err) {
      logger.warn(
        `ollama judge returned unparseable JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { raw: '', answer: 'unavailable' };
    }
    const parsed = parseJudgeReply(raw);
    if (parsed.answer === 'unavailable') {
      logger.warn(
        `ollama judge reply did not parse as YES/NO (head: ${JSON.stringify(raw.slice(0, 120))})`,
      );
    }
    const out: { raw: string; answer: JudgeAnswer; reason?: string } = {
      raw,
      answer: parsed.answer,
    };
    if (parsed.reason !== undefined) out.reason = parsed.reason;
    return out;
  }

  private post(payload: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const req = http.request(
        `${this.baseUrl}/api/chat`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          timeout: this.timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if ((res.statusCode ?? 500) >= 300) {
              reject(new Error(`ollama judge request failed (${res.statusCode}): ${text.slice(0, 200)}`));
            } else resolve(text);
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error(`ollama judge request exceeded ${this.timeoutMs}ms`)));
      req.on('error', (err) => reject(err));
      req.end(payload);
    });
  }
}

/** The judge model id folded into the cache key when the ollama provider
 *  is selected, so ollama-judged answers never collide with Haiku- or
 *  local-judged ones in the committed cache. */
export function ollamaJudgeModelId(): string {
  const model = process.env.SWARM_JUDGE_MODEL ?? 'unset';
  return `ollama:${model}`;
}
