import type { ResolvedSettings } from "./config/settings.ts";
import type { JsonValue } from "./evidence/canonical-json.ts";
import {
  type DiscoveredLocalEndpoint,
  defaultLocalEndpoints,
  discoverLocalEndpoints,
} from "./providers/local-discovery.ts";
import { readBundledShortlist } from "./select/bundled-shortlist.ts";
import { type HardwareProfile, probeHardware } from "./select/hardware-probe.ts";
import { frontierFallbackOrder } from "./select/model-fallback.ts";
import { pickServedModel } from "./select/served-pick.ts";
import type { Shortlist } from "./select/shortlist.ts";
import { systemProbeEnvironment } from "./select/system-probe.ts";

/** Long enough for a local server to answer, short enough that an absent one is not a wait. */
const discoveryTimeoutMs = 1_500;

export interface DefaultModelChoice {
  readonly modelSpec: string;
  /** One sentence for the person, printed before the session opens. */
  readonly reason: string;
  /** The `model-default` ledger record's payload: what was served, probed and chosen. */
  readonly record: JsonValue;
}

export class NoDefaultModelError extends Error {
  constructor(served: readonly DiscoveredLocalEndpoint[]) {
    const serving =
      served.length === 0
        ? "no local backend answered on the default ports"
        : served
            .map((endpoint) => `${endpoint.name} serves ${endpoint.models.join(", ") || "nothing"}`)
            .join("; ");
    super(
      `no model to run: nothing pins one, no calibration has measured this machine, ${serving}, ` +
        "and no ANTHROPIC_API_KEY, OPENAI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY is set. Pull a " +
        "model (ollama pull <id>), set a key, or pass --model <provider:id>.",
    );
    this.name = "NoDefaultModelError";
  }
}

interface DefaultModelDependencies {
  readonly discover: () => Promise<readonly DiscoveredLocalEndpoint[]>;
  readonly probe: () => Promise<HardwareProfile>;
  readonly shortlist: () => Promise<Shortlist>;
}

/**
 * What a run takes when nothing pins a model and no calibration pick exists (ADR 0011,
 * decision 2): the best served local model for this hardware, a frontier provider only where
 * nothing local is served, and a named stop where neither exists. A pinned local endpoint is
 * asked instead of the default ports, under the runtime name whose default port it matches.
 */
export async function defaultModelFor(
  settings: ResolvedSettings,
  deps: DefaultModelDependencies = systemDependencies(settings),
): Promise<DefaultModelChoice> {
  const served = await deps.discover();
  const pinned = frontierWithKey(settings);
  if (served.some((endpoint) => endpoint.models.length > 0)) {
    const [profile, shortlist] = await Promise.all([deps.probe(), deps.shortlist()]);
    const pick = pickServedModel({ served, shortlist, profile });
    if (pick !== null) {
      return {
        modelSpec: pick.modelSpec,
        reason: pick.reason,
        record: {
          modelSpec: pick.modelSpec,
          reason: pick.reason,
          ranked: pick.ranked,
          served: served.map((endpoint) => ({
            endpoint: endpoint.name,
            models: [...endpoint.models],
          })),
          hardware: { totalRamGb: profile.totalRamGb, appleSilicon: profile.appleSilicon },
          shortlistRevision: shortlist.revision,
        },
      };
    }
  }
  if (pinned !== null) {
    const reason = `no local model is served here, and a ${pinned.provider} key is set`;
    return {
      modelSpec: pinned.modelSpec,
      reason,
      record: {
        modelSpec: pinned.modelSpec,
        reason,
        ranked: false,
        served: served.map((endpoint) => ({
          endpoint: endpoint.name,
          models: [...endpoint.models],
        })),
        hardware: null,
        shortlistRevision: null,
      },
    };
  }
  throw new NoDefaultModelError(served);
}

function frontierWithKey(
  settings: ResolvedSettings,
): { readonly modelSpec: string; readonly provider: string } | null {
  const keyed: Readonly<Record<string, string | undefined>> = {
    anthropic: settings.providerKeys.anthropic,
    openai: settings.providerKeys.openai,
    google: settings.providerKeys.google,
  };
  for (const modelSpec of frontierFallbackOrder) {
    const provider = modelSpec.split(":")[0] ?? "";
    const key = keyed[provider];
    if (key !== undefined && key.length > 0) {
      return { modelSpec, provider };
    }
  }
  return null;
}

function systemDependencies(settings: ResolvedSettings): DefaultModelDependencies {
  const pinnedUrl = settings.localEndpoint?.url;
  const candidates =
    pinnedUrl === undefined
      ? undefined
      : [
          {
            name:
              defaultLocalEndpoints.find((endpoint) => endpoint.baseUrl === pinnedUrl)?.name ??
              "ollama",
            baseUrl: pinnedUrl,
          },
        ];
  return {
    discover: () =>
      discoverLocalEndpoints({
        fetch: (url) => fetch(url, { signal: AbortSignal.timeout(discoveryTimeoutMs) }),
        ...(candidates === undefined ? {} : { candidates }),
      }),
    probe: () => probeHardware(systemProbeEnvironment()),
    shortlist: readBundledShortlist,
  };
}
