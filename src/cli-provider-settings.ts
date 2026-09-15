import type { ResolvedSettings } from "./config/settings.ts";
import type { ResolvedLocalEndpoint } from "./providers/endpoint-resolution.ts";
import type { TransportTraceSink } from "./providers/transport-trace.ts";
import { createFileTraceSink } from "./providers/transport-trace-file.ts";

/**
 * The slice of the resolved settings a provider registry is built from. Apart from the rest of
 * the settings on purpose: this is the one place the settings reach the provider layer, and the
 * verify-only commands never come here.
 */
export function registrySettingsFrom(
  settings: ResolvedSettings,
  localBackend: ResolvedLocalEndpoint | null,
): {
  anthropicApiKey: string | undefined;
  openaiApiKey: string | undefined;
  googleApiKey: string | undefined;
  localBaseUrl: string | undefined;
  localThinking: boolean | null;
  transportTrace: TransportTraceSink | undefined;
} {
  return {
    anthropicApiKey: settings.providerKeys.anthropic,
    openaiApiKey: settings.providerKeys.openai,
    googleApiKey: settings.providerKeys.google,
    localBaseUrl: localBackend?.url,
    localThinking: settings.localThinking,
    // Built here rather than in the registry, so the one module that talks to a network still
    // does no file IO of its own. Nothing is opened until a call is actually traced.
    transportTrace:
      settings.transportTracePath === null
        ? undefined
        : createFileTraceSink(settings.transportTracePath),
  };
}
