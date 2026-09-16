import type { DiscoveredLocalEndpoint, LocalRuntimeName } from "../providers/local-discovery.ts";
import type { HardwareProfile } from "./hardware-probe.ts";
import { matchingTiers } from "./recommendation.ts";
import type { Shortlist } from "./shortlist.ts";

/**
 * The model a run takes when nothing pins one and no calibration has measured this machine
 * (ADR 0011, decision 2). Served decides: the shortlist ranks what a local backend actually
 * lists, and a model the shortlist has never heard of is taken only where nothing ranked is
 * served. This is a static fit read off a probe and a list, never a measurement of the model,
 * which is why a calibration pick or a pinned model wins over it.
 */
export interface ServedPick {
  /** What to pass to `--model`. */
  readonly modelSpec: string;
  readonly endpoint: LocalRuntimeName;
  /** False where nothing served is on the shortlist and the pick is a served model, unranked. */
  readonly ranked: boolean;
  /** One sentence naming the tier, or the fallback, that a person reads before the run. */
  readonly reason: string;
}

export function pickServedModel(input: {
  readonly served: readonly DiscoveredLocalEndpoint[];
  readonly shortlist: Shortlist;
  readonly profile: HardwareProfile;
}): ServedPick | null {
  const servedBy = new Map(input.served.map((endpoint) => [endpoint.name, endpoint.models]));
  if (servedBy.size === 0) {
    return null;
  }

  for (const tier of matchingTiers(input.profile, input.shortlist)) {
    for (const model of tier.models) {
      if (servedBy.get(model.backend)?.includes(model.id)) {
        return {
          modelSpec: `local:${model.id}`,
          endpoint: model.backend,
          ranked: true,
          reason:
            `the highest shortlist tier served here for ${input.profile.totalRamGb} GB ` +
            `(${tier.label}), on ${model.backend}`,
        };
      }
    }
  }

  // Nothing ranked is served. The preferred backend's first model is still a model somebody
  // pulled on purpose, which is more than the shortlist knows about this machine.
  const preferred: LocalRuntimeName = input.profile.appleSilicon ? "rapid-mlx" : "ollama";
  const backend = servedBy.has(preferred) ? preferred : [...servedBy.keys()][0];
  const first = backend === undefined ? undefined : servedBy.get(backend)?.[0];
  if (backend === undefined || first === undefined) {
    return null;
  }
  return {
    modelSpec: `local:${first}`,
    endpoint: backend,
    ranked: false,
    reason:
      `the first model ${backend} serves; nothing served here is on the shortlist for ` +
      `${input.profile.totalRamGb} GB, so this pick is not on the shortlist and is unranked`,
  };
}
