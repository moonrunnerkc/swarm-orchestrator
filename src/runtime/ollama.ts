import { z } from "zod";
import { type Message, type ModelClient, ModelError, nodePost, type Post } from "../agent/model.ts";

/** Ollama's address: OLLAMA_HOST where it is set, as Ollama itself reads it, else the default. */
export function ollamaBase(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const host = env.OLLAMA_HOST?.trim();
  if (host === undefined || host.length === 0) return "http://localhost:11434";
  return /^https?:\/\//.test(host) ? host.replace(/\/+$/, "") : `http://${host}`;
}

export interface LayerShape {
  readonly kvHeads: number;
  readonly keyLength: number;
  readonly valueLength: number;
  readonly window: number | null;
}

/** An installed model and what its metadata says about running it. */
export interface InstalledModel {
  readonly runtime: "ollama" | "openai-compatible";
  readonly name: string;
  /** The runtime's identity for these exact weights and settings. */
  readonly digest: string;
  readonly sizeBytes: number | null;
  readonly quantization: string | null;
  readonly parameters: number | null;
  readonly family: string | null;
  readonly capabilities: readonly string[];
  /** Served from elsewhere: no local weights. */
  readonly remote: boolean;
  readonly contextLength: number | null;
  /**
   * Each layer's KV cache shape: its KV heads, key and value widths, and the window a sliding
   * attention layer keeps (null for a layer that attends to the whole context). Null where the
   * metadata does not state it.
   */
  readonly attention: readonly LayerShape[] | null;
}

const tagsSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      digest: z.string(),
      size: z.number().optional(),
      remote_host: z.string().optional(),
      details: z
        .object({
          quantization_level: z.string().optional(),
          parameter_size: z.string().optional(),
          family: z.string().optional(),
        })
        .optional(),
      capabilities: z.array(z.string()).optional(),
    }),
  ),
});

const showSchema = z.object({
  capabilities: z.array(z.string()).optional(),
  model_info: z.record(z.string(), z.unknown()).optional(),
});

/** "35.5B" or "751.63M" as a count. */
export function parameterCount(text: string | undefined): number | null {
  const match = /^([\d.]+)\s*([KMBT])$/i.exec(text?.trim() ?? "");
  if (match === null) return null;
  const scale = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[
    (match[2] ?? "").toUpperCase() as "K" | "M" | "B" | "T"
  ];
  return Number(match[1]) * scale;
}

async function get(url: string, timeoutMs: number): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

async function post(url: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

/** The running Ollama's version, or null where nothing answers. */
export async function ollamaVersion(base: string): Promise<string | null> {
  try {
    const answered = z
      .object({ version: z.string() })
      .safeParse(await get(`${base}/api/version`, 3000));
    return answered.success ? answered.data.version : null;
  } catch {
    return null;
  }
}

/** Every model Ollama lists, with the attention shape `/api/show` reports for the local ones. */
export async function listOllama(base: string): Promise<InstalledModel[]> {
  const tags = tagsSchema.parse(await get(`${base}/api/tags`, 10_000));
  const models: InstalledModel[] = [];
  for (const tag of tags.models) {
    const remote = tag.remote_host !== undefined;
    const shown = remote
      ? null
      : // Verbose, so per-layer values come back as lists rather than being left out.
        showSchema.safeParse(
          await post(`${base}/api/show`, { model: tag.name, verbose: true }, 60_000),
        );
    const info = shown?.success ? (shown.data.model_info ?? {}) : {};
    const architecture =
      typeof info["general.architecture"] === "string" ? info["general.architecture"] : null;
    const raw = (key: string) =>
      architecture === null ? undefined : info[`${architecture}.${key}`];
    const read = (key: string) => {
      const value = raw(key);
      return typeof value === "number" ? value : null;
    };
    const layers = read("block_count");
    const kvHeads = raw("attention.head_count_kv");
    const heads = read("attention.head_count");
    const width = read("embedding_length");
    const keyLength =
      read("attention.key_length") ?? (width !== null && heads !== null ? width / heads : null);
    const valueLength = read("attention.value_length") ?? keyLength;
    const window = read("attention.sliding_window");
    const pattern = raw("attention.sliding_window_pattern");
    const attention: LayerShape[] | null =
      layers === null || keyLength === null || valueLength === null
        ? null
        : Array.from({ length: layers }, (_, at) => {
            const count = Array.isArray(kvHeads) ? kvHeads[at] : kvHeads;
            const sliding = window !== null && Array.isArray(pattern) && pattern[at] === true;
            return {
              kvHeads: typeof count === "number" ? count : Number.NaN,
              keyLength: sliding ? (read("attention.key_length_swa") ?? keyLength) : keyLength,
              valueLength: sliding
                ? (read("attention.value_length_swa") ?? valueLength)
                : valueLength,
              window: sliding ? window : null,
            };
          });
    const stated = attention !== null && attention.every((layer) => Number.isFinite(layer.kvHeads));
    models.push({
      runtime: "ollama",
      name: tag.name,
      digest: tag.digest,
      sizeBytes: tag.size ?? null,
      quantization: tag.details?.quantization_level || null,
      parameters: parameterCount(tag.details?.parameter_size),
      family: tag.details?.family || null,
      capabilities:
        (shown?.success ? shown.data.capabilities : undefined) ?? tag.capabilities ?? [],
      remote,
      contextLength: read("context_length"),
      attention: stated ? attention : null,
    });
  }
  return models;
}

const chatSchema = z.object({
  message: z.object({ content: z.string().optional() }),
  done_reason: z.string().optional(),
  prompt_eval_count: z.number().optional(),
  eval_count: z.number().optional(),
  total_duration: z.number().optional(),
  eval_duration: z.number().optional(),
});

/**
 * Ollama's own chat API, which takes the context size and turns thinking off; its
 * OpenAI-compatible endpoint does neither. Counts and durations come from the runtime.
 */
export function ollamaChat(options: {
  readonly base: string;
  readonly model: string;
  readonly contextTokens: number;
  /** How long Ollama keeps the model loaded after a turn; "0" unloads it at once. */
  readonly keepAlive?: string;
  readonly post?: Post;
  readonly timeoutMs?: number;
}): ModelClient {
  const send = options.post ?? nodePost;
  const url = `${options.base}/api/chat`;
  return {
    model: options.model,
    async complete(messages: readonly Message[], { signal, maxTokens }) {
      const timeout = AbortSignal.timeout(options.timeoutMs ?? 900_000);
      let response: { readonly status: number; readonly text: string };
      try {
        response = await send(
          url,
          { "content-type": "application/json" },
          JSON.stringify({
            model: options.model,
            messages,
            stream: false,
            think: false,
            keep_alive: options.keepAlive ?? "10m",
            options: { num_ctx: options.contextTokens, num_predict: maxTokens, temperature: 0 },
          }),
          { signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]) },
        );
      } catch (error) {
        if (signal?.aborted) throw error;
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ECONNREFUSED") {
          throw new ModelError(
            `Ollama is not answering at ${options.base}: start it with \`ollama serve\` (or open the Ollama app), then run again`,
          );
        }
        throw new ModelError(
          `${error instanceof Error ? error.message : String(error)} from ${url}`,
        );
      }
      if (response.status !== 200)
        throw new ModelError(`HTTP ${response.status} from ${url}: ${response.text.slice(0, 300)}`);
      const parsed = chatSchema.safeParse(JSON.parse(response.text));
      if (!parsed.success)
        throw new ModelError(
          `the reply is not an Ollama chat response: ${response.text.slice(0, 300)}`,
        );
      const reply = parsed.data;
      return {
        content: (reply.message.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim(),
        inputTokens: reply.prompt_eval_count ?? null,
        outputTokens: reply.eval_count ?? null,
        inferenceMs:
          reply.total_duration === undefined ? null : Math.round(reply.total_duration / 1e6),
        outputMs: reply.eval_duration === undefined ? null : Math.round(reply.eval_duration / 1e6),
        retries: 0,
        truncated: reply.done_reason === "length",
      };
    },
  };
}
