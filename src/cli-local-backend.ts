import { arch, platform } from "node:os";

import type { ResolvedSettings } from "./config/settings.ts";
import {
  type ResolvedLocalEndpoint,
  resolveLocalEndpoint,
} from "./providers/endpoint-resolution.ts";
import { discoverLocalEndpoints } from "./providers/local-discovery.ts";
import type { ModelSpec } from "./providers/model-spec.ts";

/** Long enough for a local server to answer, short enough that an absent one is not a wait. */
const discoveryTimeoutMs = 1_500;

/**
 * Where a local model is served, or null where nothing asked for one. Shared by every command
 * that may route to a local backend rather than defined beside one of them, so the discovery
 * timeout and the Apple Silicon check cannot drift between callers.
 */
export async function resolveLocalBackend(
  settings: ResolvedSettings,
  specs: readonly ModelSpec[],
): Promise<ResolvedLocalEndpoint | null> {
  if (!specs.some((spec) => spec.provider === "local")) {
    return null;
  }
  return resolveLocalEndpoint({
    pinned: settings.localEndpoint,
    discover: () =>
      discoverLocalEndpoints({
        fetch: (url) => fetch(url, { signal: AbortSignal.timeout(discoveryTimeoutMs) }),
      }),
    appleSilicon: platform() === "darwin" && arch() === "arm64",
  });
}
