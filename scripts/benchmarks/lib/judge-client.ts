// Provider-agnostic judge client for the benchmark harnesses, wrapped by
// the committed cache. Two providers:
//
//   - local (default): any OpenAI-compatible /chat/completions endpoint.
//     Brad's rapid-mlx server at http://localhost:8000/v1 serves
//     glm47-flash-abl, which is free to call and keeps calibration and
//     evasion sweeps off the metered API. Reasoning-style models emit a
//     short chain of thought, so the verdict is parsed from a trailing
//     "VERDICT: YES|NO" line rather than the first token.
//   - anthropic: the pinned production judge (Haiku) via the SDK, used
//     when SWARM_JUDGE_PROVIDER=anthropic so a run can be reproduced
//     against the model that ships in production.
//
// Production detection still defaults to Anthropic Haiku (see
// src/audit/cheat-detector/llm-judge). This client exists so the
// benchmark numbers can be produced for free and replayed from cache; the
// A/B holds the judge model fixed across pre and post so the delta
// isolates the pipeline change, not the model.

import { JudgeCache, judgeCacheKey, type JudgeCacheEntry } from './judge-cache';

export type Verdict = 'yes' | 'no' | 'unavailable';

export interface JudgeAnswer {
  answer: Verdict;
  reason?: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  cacheHit: boolean;
}

export interface JudgeProviderConfig {
  provider: 'local' | 'anthropic' | 'ollama';
  model: string;
  baseUrl: string;
  maxTokens: number;
}

export function resolveProvider(): JudgeProviderConfig {
  const raw = (process.env.SWARM_JUDGE_PROVIDER ?? '').toLowerCase();
  if (raw === 'anthropic') {
    return {
      provider: 'anthropic',
      model: process.env.SWARM_JUDGE_MODEL ?? 'claude-haiku-4-5-20251001',
      baseUrl: '',
      maxTokens: 256,
    };
  }
  // Ollama native /api/chat. A thinking model (qwen3) only honors think:false
  // here, not on its /v1 bridge (where it spends the budget reasoning and
  // returns empty content). The model id is required and folds into the cache
  // key, so ollama answers never collide with the OpenAI-compatible ones.
  if (raw === 'ollama') {
    return {
      provider: 'ollama',
      model: process.env.SWARM_JUDGE_MODEL ?? '',
      baseUrl: (
        process.env.SWARM_JUDGE_BASE_URL ??
        process.env.OLLAMA_BASE_URL ??
        'http://localhost:11434'
      ).replace(/\/$/, ''),
      maxTokens: 256,
    };
  }
  return {
    provider: 'local',
    model: process.env.SWARM_JUDGE_MODEL ?? 'glm47-flash-abl',
    baseUrl: process.env.SWARM_JUDGE_BASE_URL ?? 'http://localhost:8000/v1',
    // Non-thinking mode answers in a handful of tokens, so a tight cap is
    // plenty and keeps a runaway generation from stalling a sweep.
    maxTokens: 256,
  };
}

/** Append the verdict-format instruction so any model, reasoning or not,
 *  ends on a parseable line. Production prompts ask for one line; the
 *  local reasoning models ignore that, so the benchmark harness is
 *  explicit about the sentinel. */
export function withVerdictSuffix(user: string): string {
  return (
    `${user}\n\n` +
    'After any reasoning, end your reply with a final line in exactly this ' +
    'format and nothing after it:\nVERDICT: YES\nor\nVERDICT: NO'
  );
}

export function parseVerdict(text: string): { answer: Verdict; reason?: string } {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { answer: 'unavailable' };
  const verdictMatch = /VERDICT:\s*(YES|NO)\b/giu;
  let last: RegExpExecArray | null = null;
  for (let m = verdictMatch.exec(trimmed); m !== null; m = verdictMatch.exec(trimmed)) {
    last = m;
  }
  if (last !== null) {
    const tag = (last[1] ?? '').toUpperCase();
    const reason = firstReasonLine(trimmed);
    const out: { answer: Verdict; reason?: string } = { answer: tag === 'YES' ? 'yes' : 'no' };
    if (reason !== undefined) out.reason = reason;
    return out;
  }
  // Fallback: a leading YES/NO (the production one-line format).
  const lead = /^(YES|NO)\b[\s:.,-]*([\s\S]*)$/iu.exec(trimmed);
  if (lead !== null) {
    const tag = (lead[1] ?? '').toUpperCase();
    const reasonRaw = (lead[2] ?? '').trim();
    const out: { answer: Verdict; reason?: string } = { answer: tag === 'YES' ? 'yes' : 'no' };
    if (reasonRaw.length > 0) out.reason = reasonRaw.split('\n')[0];
    return out;
  }
  return { answer: 'unavailable' };
}

function firstReasonLine(text: string): string | undefined {
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.length === 0) continue;
    if (/^VERDICT:/iu.test(t)) continue;
    return t.slice(0, 400);
  }
  return undefined;
}

export class BenchJudge {
  private readonly cfg: JudgeProviderConfig;
  private readonly cache: JudgeCache;
  private liveCalls = 0;

  constructor(cache: JudgeCache, cfg = resolveProvider()) {
    this.cache = cache;
    this.cfg = cfg;
  }

  liveCallCount(): number {
    return this.liveCalls;
  }

  config(): JudgeProviderConfig {
    return this.cfg;
  }

  /**
   * Ask the judge. Cache hit returns the frozen entry (no network). Cache
   * miss makes one live call; if no provider is reachable the answer is
   * 'unavailable' and is NOT cached (so a later run with a model up can
   * fill it). `allowLive=false` forces cache-only (the byte-identical
   * replay path).
   */
  async ask(system: string, user: string, allowLive: boolean): Promise<JudgeAnswer> {
    const fullUser = withVerdictSuffix(user);
    const key = judgeCacheKey(this.cfg.model, system, fullUser);
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      const out: JudgeAnswer = {
        answer: cached.answer,
        promptTokens: cached.promptTokens,
        completionTokens: cached.completionTokens,
        latencyMs: cached.latencyMs,
        cacheHit: true,
      };
      if (cached.reason !== undefined) out.reason = cached.reason;
      return out;
    }
    if (!allowLive) {
      return {
        answer: 'unavailable',
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: 0,
        cacheHit: false,
      };
    }
    const live = await this.call(system, fullUser);
    this.liveCalls += 1;
    if (live.answer !== 'unavailable') {
      const entry: JudgeCacheEntry = {
        model: this.cfg.model,
        answer: live.answer,
        promptTokens: live.promptTokens,
        completionTokens: live.completionTokens,
        latencyMs: live.latencyMs,
      };
      if (live.reason !== undefined) entry.reason = live.reason;
      this.cache.set(key, entry);
    }
    return { ...live, cacheHit: false };
  }

  private async call(
    system: string,
    user: string,
  ): Promise<Omit<JudgeAnswer, 'cacheHit'>> {
    const started = Date.now();
    try {
      const reply =
        this.cfg.provider === 'anthropic'
          ? await this.callAnthropic(system, user)
          : this.cfg.provider === 'ollama'
            ? await this.callOllama(system, user)
            : await this.callOpenAiCompatible(system, user);
      const parsed = parseVerdict(reply.text);
      const latencyMs = Date.now() - started;
      const out: Omit<JudgeAnswer, 'cacheHit'> = {
        answer: parsed.answer,
        promptTokens: reply.promptTokens,
        completionTokens: reply.completionTokens,
        latencyMs,
      };
      if (parsed.reason !== undefined) out.reason = parsed.reason;
      return out;
    } catch (err) {
      process.stderr.write(
        `bench-judge: live call failed (${(err as Error).message}); returning unavailable\n`,
      );
      return {
        answer: 'unavailable',
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: Date.now() - started,
      };
    }
  }

  private async callOpenAiCompatible(
    system: string,
    user: string,
  ): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
    const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.cfg.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: this.cfg.maxTokens,
        temperature: 0,
        // rapid-mlx serves reasoning-style models (GLM) that otherwise
        // burn the whole token budget thinking and get truncated before
        // the verdict line. Disabling thinking yields a one-line verdict
        // in a handful of tokens. Servers that do not know this field
        // ignore it.
        enable_thinking: false,
      }),
    });
    if (!res.ok) {
      throw new Error(`${this.cfg.baseUrl} returned HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: json.choices?.[0]?.message?.content ?? '',
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
    };
  }

  private async callOllama(
    system: string,
    user: string,
  ): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
    if (this.cfg.model.length === 0) {
      throw new Error('ollama judge selected but SWARM_JUDGE_MODEL is unset');
    }
    const res = await fetch(`${this.cfg.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.cfg.model,
        // Native /api/chat is the only endpoint that honors think:false for a
        // reasoning model; the /v1 bridge cannot, so it returns empty content.
        think: false,
        stream: false,
        options: { temperature: 0, num_predict: this.cfg.maxTokens },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`${this.cfg.baseUrl} returned HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    return {
      text: json.message?.content ?? '',
      promptTokens: json.prompt_eval_count ?? 0,
      completionTokens: json.eval_count ?? 0,
    };
  }

  private async callAnthropic(
    system: string,
    user: string,
  ): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
    // Lazy import so the local default never loads the SDK.
    const mod = (await import('@anthropic-ai/sdk')) as unknown as {
      default: new (opts: { apiKey?: string }) => {
        messages: {
          create(req: unknown): Promise<{
            content?: { type: string; text?: string }[];
            usage?: { input_tokens?: number; output_tokens?: number };
          }>;
        };
      };
    };
    const Anthropic = mod.default;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const client = new Anthropic(apiKey === undefined ? {} : { apiKey });
    const response = await client.messages.create({
      model: this.cfg.model,
      max_tokens: this.cfg.maxTokens,
      temperature: 0,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const text = (response.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text ?? '')
      .join('')
      .trim();
    return {
      text,
      promptTokens: response.usage?.input_tokens ?? 0,
      completionTokens: response.usage?.output_tokens ?? 0,
    };
  }
}

/** Anthropic Haiku list price (USD per token) as of 2026-06, used to put
 *  an honest dollar figure on judge usage even when the benchmark ran
 *  against a free local model. Labeled as a list-price estimate wherever
 *  it surfaces. */
export const HAIKU_USD_PER_INPUT_TOKEN = 1.0 / 1_000_000;
export const HAIKU_USD_PER_OUTPUT_TOKEN = 5.0 / 1_000_000;

export function estimateHaikuUsd(promptTokens: number, completionTokens: number): number {
  return (
    promptTokens * HAIKU_USD_PER_INPUT_TOKEN + completionTokens * HAIKU_USD_PER_OUTPUT_TOKEN
  );
}
