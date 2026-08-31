import { describe, expect, it } from "vitest";
import { respondWithText } from "./fixture-provider.ts";
import { InvalidModelSpecError, parseModelSpec, providerIds } from "./model-spec.ts";
import {
  createProviderRegistry,
  ProviderNotConfiguredError,
  type ProviderSettings,
} from "./registry.ts";
import type { TransportTraceEntry } from "./transport-trace.ts";

const configured: ProviderSettings = {
  anthropicApiKey: "test-anthropic-key",
  openaiApiKey: "test-openai-key",
  googleApiKey: "test-google-key",
  localBaseUrl: "http://127.0.0.1:11434/v1",
  fixtureScript: { modelId: "fixture:test", turns: [respondWithText("hello")] },
};

describe("parseModelSpec", () => {
  it("splits provider from model id", () => {
    expect(parseModelSpec("anthropic:claude-opus-5")).toEqual({
      provider: "anthropic",
      modelId: "claude-opus-5",
    });
  });

  it("keeps colons inside a local model tag", () => {
    expect(parseModelSpec("local:qwen3.6:35b-a3b")).toEqual({
      provider: "local",
      modelId: "qwen3.6:35b-a3b",
    });
  });

  it("names the known providers when the prefix is wrong", () => {
    expect(() => parseModelSpec("bedrock:claude")).toThrow(InvalidModelSpecError);
    expect(() => parseModelSpec("bedrock:claude")).toThrow(/anthropic, openai, google/);
  });

  it("refuses a spec with no provider prefix or no model id", () => {
    expect(() => parseModelSpec("claude-opus-5")).toThrow(InvalidModelSpecError);
    expect(() => parseModelSpec("anthropic:")).toThrow(InvalidModelSpecError);
  });
});

describe("provider registry", () => {
  it("lists every provider it can build", () => {
    expect(createProviderRegistry(configured).providerIds).toEqual(providerIds);
    expect(providerIds).toEqual(["anthropic", "openai", "google", "local", "fixture"]);
  });

  it("builds a client for each frontier provider without touching the network", () => {
    const registry = createProviderRegistry(configured);

    for (const spec of ["anthropic:claude-opus-5", "openai:gpt-5", "google:gemini-3-pro"]) {
      expect(registry.create(parseModelSpec(spec)).modelId).toBe(spec);
    }
  });

  it("builds a local client through the OpenAI-compatible adapter", () => {
    const registry = createProviderRegistry(configured);
    const client = registry.create(parseModelSpec("local:qwen3.6:35b-a3b"));
    expect(client.modelId).toBe("local:qwen3.6:35b-a3b");
  });

  it("refuses a local model with no endpoint rather than guessing a port", () => {
    // The silent Ollama fallback is gone on purpose: the composition root resolves an
    // endpoint (pinned or discovered) and records it, so a guess here would bypass that.
    const registry = createProviderRegistry({ ...configured, localBaseUrl: undefined });

    expect(() => registry.create(parseModelSpec("local:gemma4:e4b"))).toThrow(
      ProviderNotConfiguredError,
    );
    expect(() => registry.create(parseModelSpec("local:gemma4:e4b"))).toThrow(
      /no local endpoint was resolved/,
    );
  });

  it("builds the fixture provider from its script", async () => {
    const registry = createProviderRegistry(configured);
    const client = registry.create(parseModelSpec("fixture:anything"));

    const response = await client.generate({
      system: "",
      messages: [],
      tools: [],
      maxOutputTokens: 16,
      abortSignal: new AbortController().signal,
    });

    expect(client.modelId).toBe("fixture:test");
    expect(response.text).toBe("hello");
  });

  it("says which credential is missing instead of failing at call time", () => {
    const registry = createProviderRegistry({});

    expect(() => registry.create(parseModelSpec("anthropic:claude-opus-5"))).toThrow(
      ProviderNotConfiguredError,
    );
    expect(() => registry.create(parseModelSpec("anthropic:claude-opus-5"))).toThrow(
      /ANTHROPIC_API_KEY/,
    );
    expect(() => registry.create(parseModelSpec("openai:gpt-5"))).toThrow(/OPENAI_API_KEY/);
    expect(() => registry.create(parseModelSpec("google:gemini-3-pro"))).toThrow(
      /GOOGLE_GENERATIVE_AI_API_KEY/,
    );
    expect(() => registry.create(parseModelSpec("fixture:x"))).toThrow(/fixture script/);
  });
});

describe("what a local backend is asked to report", () => {
  /**
   * The defect this covers, found by a calibration run whose throughput dimension read 0.0 for
   * every run of every model: an OpenAI-compatible server streams no usage chunk unless the
   * request carries `stream_options.include_usage`, and the SDK only sends that when the
   * provider is built with `includeUsage`. Without it every token count arrives as zero, which
   * zeroes the cost of every local run and the reward the router learns from, and leaves a
   * calibration dimension printing a number it never measured.
   */
  it("asks for usage, so token counts are not silently zero", async () => {
    const requests: { readonly url: string; readonly body: unknown }[] = [];
    const registry = createProviderRegistry({
      localBaseUrl: "http://127.0.0.1:11434/v1",
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({
          url: String(url),
          body: JSON.parse(String(init?.body ?? "{}")),
        });
        return new Response("data: [DONE]\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }) as typeof fetch,
    });

    const model = registry.create(parseModelSpec("local:qwen3.6:35b-a3b"));
    await model
      .generate({
        system: "s",
        messages: [{ role: "user", text: "hi" }],
        tools: [],
        maxOutputTokens: 16,
        abortSignal: new AbortController().signal,
      })
      .catch(() => undefined);

    const body = requests[0]?.body as { stream_options?: { include_usage?: boolean } };
    expect(body?.stream_options?.include_usage).toBe(true);
  });
});

describe("the transport trace", () => {
  /**
   * Wired here rather than tested only in isolation, because the question it exists to answer
   * is about the bodies this registry's adapter actually puts on the wire. A tracer that works
   * on a hand-built fetch and is never reached from the local case answers nothing.
   */
  async function traceOneLocalCall(
    frames: readonly string[],
    trace: TransportTraceEntry[] | undefined,
  ): Promise<void> {
    const registry = createProviderRegistry({
      localBaseUrl: "http://127.0.0.1:11434/v1",
      ...(trace === undefined
        ? {}
        : {
            transportTrace: {
              write(entry) {
                trace.push(entry);
                return Promise.resolve();
              },
            },
          }),
      fetch: (async () =>
        new Response(frames.join(""), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        })) as typeof fetch,
    });

    await registry
      .create(parseModelSpec("local:qwen3.6:35b-a3b"))
      .generate({
        system: "s",
        messages: [{ role: "user", text: "hi" }],
        tools: [],
        maxOutputTokens: 16,
        abortSignal: new AbortController().signal,
      })
      .catch(() => undefined);
  }

  it("copies the raw request body and the raw response frames of a local call", async () => {
    const trace: TransportTraceEntry[] = [];
    await traceOneLocalCall(["data: [DONE]\n\n"], trace);
    await new Promise((resume) => setTimeout(resume, 0));

    const request = trace.find((entry) => entry.event === "request");
    expect(request?.event === "request" && JSON.parse(request.body ?? "{}")).toMatchObject({
      model: "qwen3.6:35b-a3b",
    });
    const chunks = trace.filter((entry) => entry.event === "response-chunk");
    expect(chunks.map((chunk) => (chunk.event === "response-chunk" ? chunk.text : ""))).toEqual([
      "data: [DONE]\n\n",
    ]);
  });

  it("writes nothing at all when no sink was asked for", async () => {
    // The default. A debug artifact holding whole prompts is not a thing to leave running.
    await expect(traceOneLocalCall(["data: [DONE]\n\n"], undefined)).resolves.toBeUndefined();
  });
});
