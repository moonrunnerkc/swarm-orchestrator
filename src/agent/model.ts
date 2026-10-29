import { z } from "zod";

export interface Message {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface Reply {
  readonly content: string;
  /** Tokens the endpoint reported, or null where it reported none. */
  readonly tokens: number | null;
}

export interface ModelClient {
  readonly model: string;
  complete(messages: readonly Message[], signal?: AbortSignal): Promise<Reply>;
}

const responseSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable().optional() }) }))
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().nonnegative(),
      completion_tokens: z.number().nonnegative(),
    })
    .optional(),
});

export class ModelError extends Error {
  constructor(detail: string) {
    super(`the model endpoint failed: ${detail}`);
    this.name = "ModelError";
  }
}

/** Reasoning some local models print before the answer; it is not the answer. */
const thinking = /<think>[\s\S]*?<\/think>/g;

/**
 * Chat completions over any OpenAI-compatible endpoint (Ollama, vLLM, MLX servers, hosted
 * APIs), at temperature 0. Network failures and 5xx answers are retried twice.
 */
export function openAiCompatible(options: {
  readonly endpoint: string;
  readonly model: string;
  readonly apiKey: string | null;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}): ModelClient {
  const send = options.fetch ?? fetch;
  const url = `${options.endpoint.replace(/\/+$/, "")}/chat/completions`;
  return {
    model: options.model,
    async complete(messages, signal) {
      let lastProblem = "";
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const timeout = AbortSignal.timeout(options.timeoutMs ?? 600_000);
        let response: Response;
        try {
          response = await send(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(options.apiKey === null ? {} : { authorization: `Bearer ${options.apiKey}` }),
            },
            body: JSON.stringify({ model: options.model, messages, temperature: 0, stream: false }),
            signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
          });
        } catch (error) {
          if (signal?.aborted) throw error;
          lastProblem = error instanceof Error ? error.message : String(error);
          continue;
        }
        const text = await response.text();
        if (response.status >= 500) {
          lastProblem = `HTTP ${response.status}: ${text.slice(0, 300)}`;
          continue;
        }
        if (!response.ok) throw new ModelError(`HTTP ${response.status}: ${text.slice(0, 300)}`);
        let parsed: z.infer<typeof responseSchema>;
        try {
          parsed = responseSchema.parse(JSON.parse(text));
        } catch {
          throw new ModelError(`the response is not a chat completion: ${text.slice(0, 300)}`);
        }
        const usage = parsed.usage;
        return {
          content: (parsed.choices[0]?.message.content ?? "").replace(thinking, "").trim(),
          tokens: usage === undefined ? null : usage.prompt_tokens + usage.completion_tokens,
        };
      }
      throw new ModelError(lastProblem);
    },
  };
}
