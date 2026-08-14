import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ModelClient } from "../core/model-client.ts";
import { createAiSdkModelClient } from "./ai-sdk-model-client.ts";
import { createFixtureModelClient, type FixtureScript } from "./fixture-provider.ts";
import type { ModelSpec, ProviderId } from "./model-spec.ts";
import { providerIds } from "./model-spec.ts";

export interface ProviderSettings {
  readonly anthropicApiKey?: string | undefined;
  readonly openaiApiKey?: string | undefined;
  readonly googleApiKey?: string | undefined;
  /** OpenAI-compatible base url. Serves both Ollama and rapid-mlx through one adapter. */
  readonly localBaseUrl?: string | undefined;
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

export interface ProviderRegistry {
  readonly providerIds: readonly ProviderId[];
  create(spec: ModelSpec): ModelClient;
}

/**
 * The one place the AI SDK is constructed. Settings arrive already resolved, so the
 * registry itself reads no environment and stays testable without a network.
 */
export function createProviderRegistry(settings: ProviderSettings): ProviderRegistry {
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
          const local = createOpenAICompatible({ name: "local", baseURL: settings.localBaseUrl });
          return createAiSdkModelClient(label, local(spec.modelId));
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

function requireApiKey(value: string | undefined, provider: ProviderId, remedy: string): string {
  if (value === undefined || value.length === 0) {
    throw new ProviderNotConfiguredError(provider, remedy);
  }
  return value;
}
