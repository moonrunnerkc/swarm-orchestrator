import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { JSONValue } from "ai";
import type { ModelClient } from "../core/model-client.ts";
import { createAiSdkModelClient } from "./ai-sdk-model-client.ts";
import { createFixtureModelClient, type FixtureScript } from "./fixture-provider.ts";
import { createLocalFetch } from "./local-fetch.ts";
import type { ModelSpec, ProviderId } from "./model-spec.ts";
import { providerIds } from "./model-spec.ts";
import { createTracingFetch, type TransportTraceSink } from "./transport-trace.ts";

export interface ProviderSettings {
  readonly anthropicApiKey?: string | undefined;
  readonly openaiApiKey?: string | undefined;
  readonly googleApiKey?: string | undefined;
  /** OpenAI-compatible base url. Serves both Ollama and rapid-mlx through one adapter. */
  readonly localBaseUrl?: string | undefined;
  /**
   * Whether the model behind the local endpoint should reason before it answers. Undefined
   * sends nothing and leaves the server's own default alone.
   */
  readonly localThinking?: boolean | null | undefined;
  /**
   * What the local adapter sends requests with. Present so the one module allowed to talk to
   * a network can be asked what it puts on the wire, which is how the missing usage request
   * below is held to: absent, it is the global.
   */
  readonly fetch?: typeof globalThis.fetch | undefined;
  /**
   * Where the raw bodies of local calls are copied, before anything parses them. Absent is
   * the default and writes nothing. Local only: the question it answers is about a local
   * runtime's stream, and a frontier provider's traffic is not this project's to record.
   */
  readonly transportTrace?: TransportTraceSink | undefined;
  readonly fixtureScript?: FixtureScript | undefined;
}

export class ProviderNotConfiguredError extends Error {
  readonly provider: ProviderId;

  constructor(provider: ProviderId, remedy: string) {
    super(`provider "${provider}" is not configured: ${remedy}`);
    this.name = "ProviderNotConfiguredError";
    this.provider = provider;
  }
}

interface ProviderRegistry {
  readonly providerIds: readonly ProviderId[];
  create(spec: ModelSpec): ModelClient;
}

/**
 * The one place the AI SDK is constructed. Settings arrive already resolved, so the
 * registry itself reads no environment and stays testable without a network.
 */
export function createProviderRegistry(settings: ProviderSettings): ProviderRegistry {
  // Built once per registry rather than once per model. A calibration sweep asks for a fresh
  // client per repeat, and a fetch per client is a call counter per client: the first trace of
  // a real sweep held 23 requests sharing 8 call numbers, so no request could be matched to
  // the response it got, which is the one thing the artifact exists to let a reader do.
  const localFetch = tracedFetch(settings);

  return {
    providerIds,
    create(spec: ModelSpec): ModelClient {
      const label = `${spec.provider}:${spec.modelId}`;

      switch (spec.provider) {
        case "anthropic": {
          const apiKey = requireApiKey(
            settings.anthropicApiKey,
            "anthropic",
            "set ANTHROPIC_API_KEY",
          );
          return createAiSdkModelClient(label, createAnthropic({ apiKey })(spec.modelId));
        }
        case "openai": {
          const apiKey = requireApiKey(settings.openaiApiKey, "openai", "set OPENAI_API_KEY");
          return createAiSdkModelClient(label, createOpenAI({ apiKey })(spec.modelId));
        }
        case "google": {
          const apiKey = requireApiKey(
            settings.googleApiKey,
            "google",
            "set GOOGLE_GENERATIVE_AI_API_KEY",
          );
          return createAiSdkModelClient(label, createGoogleGenerativeAI({ apiKey })(spec.modelId));
        }
        case "local": {
          if (settings.localBaseUrl === undefined) {
            // Never guess a port here: the composition root resolves an endpoint, pinned
            // or discovered, and records it, and a fallback would bypass that record.
            throw new ProviderNotConfiguredError(
              "local",
              "no local endpoint was resolved. Pass --local-endpoint, set " +
                "SWARM_LOCAL_BASE_URL, set [providers] local_endpoint in swarm.toml, or " +
                "start Ollama or rapid-mlx so discovery can find one",
            );
          }
          // includeUsage sends stream_options.include_usage, without which an
          // OpenAI-compatible server streams no usage chunk at all and every token count
          // arrives as zero. That is not cosmetic: it zeroes the cost of every local run,
          // zeroes the reward the router learns from, and makes the calibration's throughput
          // dimension report 0.0 for every run of every model, which reads as a measurement.
          const local = createOpenAICompatible({
            name: "local",
            baseURL: settings.localBaseUrl,
            includeUsage: true,
            fetch: localFetch,
          });
          return createAiSdkModelClient(label, local(spec.modelId), thinkingOptions(settings));
        }
        case "fixture": {
          if (settings.fixtureScript === undefined) {
            throw new ProviderNotConfiguredError(
              "fixture",
              "no fixture script was supplied to the registry",
            );
          }
          return createFixtureModelClient(settings.fixtureScript);
        }
      }
    },
  };
}

/**
 * The fetch local calls go out through. A caller's own wins, which is what the tests inject;
 * otherwise the one that waits, because a local endpoint goes quiet for as long as it takes to
 * write the file. Either is wrapped in the tracer when an operator asked for one, outermost on
 * purpose, so what the trace records is what the transport was handed rather than what this
 * module meant to send.
 */
function tracedFetch(settings: ProviderSettings): typeof globalThis.fetch {
  const base = settings.fetch ?? createLocalFetch();
  return settings.transportTrace === undefined
    ? base
    : createTracingFetch({
        inner: base,
        sink: settings.transportTrace,
        now: () => Date.now(),
      });
}

/**
 * Whether the model behind the local endpoint should reason before it answers, in the two
 * spellings the servers that accept it use: rapid-mlx and vLLM read the top-level field, and
 * the templated form is what a server that passes the flag to its chat template wants.
 *
 * Off unless a setup asks for it on, which is a default chosen from a measurement rather than
 * a preference. A reasoning model given tools spends its output budget thinking about the edit
 * instead of making it: against rapid-mlx serving qwen3.8:27b the same task truncated at the
 * 8192-token cap on four runs out of four with reasoning on, and finished in seven steps and
 * thirty-four seconds with it off. `[providers] local_thinking = true` puts it back for a setup
 * that wants it, and nothing here reaches a frontier provider.
 *
 * A server that rejects the field is handled where the call is made rather than guessed at
 * here: the client retries once without it, so an unrecognised extension costs one request
 * rather than every request.
 */
function thinkingOptions(
  settings: ProviderSettings,
): Record<string, Record<string, JSONValue>> | undefined {
  const enabled = settings.localThinking ?? false;
  return {
    local: { enable_thinking: enabled, chat_template_kwargs: { enable_thinking: enabled } },
  };
}

function requireApiKey(value: string | undefined, provider: ProviderId, remedy: string): string {
  if (value === undefined || value.length === 0) {
    throw new ProviderNotConfiguredError(provider, remedy);
  }
  return value;
}
