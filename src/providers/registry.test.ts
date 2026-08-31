import { describe, expect, it } from "vitest";
import { respondWithText } from "./fixture-provider.ts";
import { InvalidModelSpecError, parseModelSpec, providerIds } from "./model-spec.ts";
import {
  createProviderRegistry,
  ProviderNotConfiguredError,
  type ProviderSettings,
} from "./registry.ts";

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

describe("what the decoding settings reach on the wire", () => {
  /**
   * The other half of the same guarantee the calibration run asserts against its ledger: a
   * report that names the distribution its numbers were drawn under is only true if the
   * settings were on the request. Nothing here reaches inside the SDK; it reads the body.
   */
  it("carries temperature, top_p and the seed in the request body", async () => {
    let body: Record<string, unknown> = {};
    const registry = createProviderRegistry({
      localBaseUrl: "http://127.0.0.1:8000/v1",
      fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
        body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return new Response("data: [DONE]\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }) as typeof globalThis.fetch,
    });

    await registry
      .create(parseModelSpec("local:qwen3-coder:30b-a3b"))
      .generate({
        system: "s",
        messages: [{ role: "user", text: "hi" }],
        tools: [],
        maxOutputTokens: 16,
        sampling: { temperature: 0.7, topP: 0.95, seed: 4_242 },
        abortSignal: new AbortController().signal,
      })
      .catch(() => undefined);

    expect(body).toMatchObject({ temperature: 0.7, top_p: 0.95, seed: 4_242 });
  });

  it("sends no seed field at all when there is no seed to send", async () => {
    let body: Record<string, unknown> = {};
    const registry = createProviderRegistry({
      localBaseUrl: "http://127.0.0.1:8000/v1",
      fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
        body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return new Response("data: [DONE]\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }) as typeof globalThis.fetch,
    });

    await registry
      .create(parseModelSpec("local:qwen3-coder:30b-a3b"))
      .generate({
        system: "s",
        messages: [{ role: "user", text: "hi" }],
        tools: [],
        maxOutputTokens: 16,
        sampling: { temperature: 0.7, topP: 0.95, seed: null },
        abortSignal: new AbortController().signal,
      })
      .catch(() => undefined);

    // Absent rather than null: a seed of null on the wire is a value, and a server reading it
    // as one is a different run from a server that was given no seed.
    expect("seed" in body).toBe(false);
    expect(body).toMatchObject({ temperature: 0.7, top_p: 0.95 });
  });
});

describe("the raw wire trace for a local backend", () => {
  function localRegistrySettings(): {
    localBaseUrl: string;
    fetch: typeof globalThis.fetch;
  } {
    return {
      localBaseUrl: "http://127.0.0.1:8000/v1",
      fetch: (async () =>
        new Response('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n', {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        })) as typeof globalThis.fetch,
    };
  }

  async function generateOnce(registry: ReturnType<typeof createProviderRegistry>): Promise<void> {
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

  it("writes both directions when a writer is supplied", async () => {
    const written: { phase?: unknown }[] = [];
    const registry = createProviderRegistry({
      ...localRegistrySettings(),
      localTransportTrace: (entry) => {
        written.push(entry as { phase?: unknown });
      },
    });

    await generateOnce(registry);

    expect(written.map((entry) => entry.phase)).toEqual(["request", "response"]);
  });
});
