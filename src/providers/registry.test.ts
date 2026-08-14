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
