import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { z } from "zod";

export interface Message {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface Reply {
  readonly content: string;
  /** Tokens the endpoint reported, or null where it reported none. */
  readonly tokens: number | null;
  /** The endpoint stopped at the turn's completion cap. */
  readonly truncated: boolean;
}

export interface TurnOptions {
  readonly signal?: AbortSignal | undefined;
  /** The completion cap for this turn, sent as max_tokens. */
  readonly maxTokens: number;
}

export interface ModelClient {
  readonly model: string;
  complete(messages: readonly Message[], options: TurnOptions): Promise<Reply>;
}

const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable().optional() }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().nonnegative(),
      completion_tokens: z.number().nonnegative(),
    })
    .optional(),
});

/** The endpoint failed for good: the run stops, and the verifier judges the tree as it is. */
export class ModelError extends Error {
  constructor(detail: string) {
    super(`the model endpoint failed: ${detail}`);
    this.name = "ModelError";
  }
}

/** Reasoning some local models print before the answer; it is not the answer. */
const thinking = /<think>[\s\S]*?<\/think>/g;

/** One HTTP exchange: what came back, or a thrown error where nothing did. */
export type Post = (
  url: string,
  headers: Record<string, string>,
  body: string,
  options: { readonly signal: AbortSignal },
) => Promise<{ readonly status: number; readonly text: string }>;

/**
 * POST over node:http(s) with no deadline but the caller's signal. Not fetch: an endpoint that
 * answers without streaming sends its headers only when generation ends, and fetch's built-in
 * five-minute headers timeout cut long turns off before the client's own timeout.
 */
export const nodePost: Post = (url, headers, body, { signal }) =>
  new Promise((settle, fail) => {
    const send = url.startsWith("https:") ? httpsRequest : httpRequest;
    const outgoing = send(url, { method: "POST", headers, signal }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () =>
        settle({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }),
      );
      response.on("error", fail);
    });
    outgoing.on("error", fail);
    outgoing.end(body);
  });

const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * Chat completions over any OpenAI-compatible endpoint (Ollama, vLLM, MLX servers, hosted
 * APIs), at temperature 0. A refused connection or a 4xx other than 429 fails at once; other
 * network failures and 5xx answers fail on the third in a row; 429 waits and retries.
 */
export function openAiCompatible(options: {
  readonly endpoint: string;
  readonly model: string;
  readonly apiKey: string | null;
  readonly timeoutMs?: number;
  readonly post?: Post;
  readonly sleep?: (ms: number) => Promise<void>;
}): ModelClient {
  const send = options.post ?? nodePost;
  const sleep = options.sleep ?? pause;
  const url = `${options.endpoint.replace(/\/+$/, "")}/chat/completions`;
  return {
    model: options.model,
    async complete(messages, { signal, maxTokens }) {
      let lastProblem = "";
      let failures = 0;
      let waits = 0;
      while (failures < 3) {
        const timeout = AbortSignal.timeout(options.timeoutMs ?? 600_000);
        let response: { readonly status: number; readonly text: string };
        try {
          response = await send(
            url,
            {
              "content-type": "application/json",
              ...(options.apiKey === null ? {} : { authorization: `Bearer ${options.apiKey}` }),
            },
            JSON.stringify({
              model: options.model,
              messages,
              temperature: 0,
              stream: false,
              max_tokens: maxTokens,
            }),
            { signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]) },
          );
        } catch (error) {
          if (signal?.aborted) throw error;
          const code = (error as NodeJS.ErrnoException).code;
          // A refused connection to localhost arrives as an AggregateError with no message.
          const problem = (error instanceof Error && error.message) || code || String(error);
          if (code === "ECONNREFUSED") throw new ModelError(`connection refused at ${url}`);
          lastProblem = problem;
          failures += 1;
          continue;
        }
        const { status, text } = response;
        if (status === 429 && waits < 6) {
          waits += 1;
          await sleep(Math.min(60_000, 2 ** waits * 1000));
          continue;
        }
        if (status >= 500) {
          lastProblem = `HTTP ${status}: ${text.slice(0, 300)}`;
          failures += 1;
          continue;
        }
        if (status < 200 || status >= 300)
          throw new ModelError(`HTTP ${status}: ${text.slice(0, 300)}`);
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
          truncated: parsed.choices[0]?.finish_reason === "length",
        };
      }
      throw new ModelError(`${lastProblem} (three attempts in a row)`);
    },
  };
}
