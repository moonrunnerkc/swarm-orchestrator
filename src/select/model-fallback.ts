import { parseModelSpec } from "../providers/model-spec.ts";
import type { LocalModelPreflight } from "./model-preflight.ts";

/**
 * What to actually run, once the backend has said what it is serving.
 *
 * The router picks from what a calibration measured, and a calibration is a record of a
 * machine at a moment. The backend answering today is a separate fact, and the two drift:
 * a model is pulled into Ollama, discovery prefers rapid-mlx, and the router hands over a
 * name that endpoint has never heard of. Dispatching it produces `Not Found` three times and
 * a run of zero steps, which tells the reader nothing about which of the two was wrong.
 *
 * So the served list decides, and it is asked rather than assumed. The order of preference is
 * a served local model first, because it costs nothing and the user asked for local, then a
 * frontier provider whose key is present. Falling back is announced and recorded: a run that
 * silently spent money on an API when it was asked for a local model would be the worse bug.
 */

export interface FrontierKeys {
  readonly anthropic: string | undefined;
  readonly openai: string | undefined;
  readonly google: string | undefined;
}

/**
 * One model id per frontier provider, because a fallback has to name something and the
 * protocol offers no "whatever you have" id the way a local backend's model list does. These
 * are the defaults only: `--model`, `SWARM_MODEL` and `[models] pin` all still win, and a
 * pinned model is never routed around.
 */
export const frontierFallbackOrder = [
  "anthropic:claude-opus-5",
  "openai:gpt-5.2",
  "google:gemini-3-pro",
] as const;

export type UsableModel =
  | { readonly outcome: "as-requested"; readonly modelSpec: string; readonly reason: string }
  | {
      readonly outcome: "substituted";
      readonly modelSpec: string;
      readonly requested: string;
      readonly reason: string;
    };

export class NoUsableModelError extends Error {
  constructor(requested: string, served: readonly string[] | null, endpoint: string) {
    const serving =
      served === null
        ? `${endpoint} could not be asked what it serves`
        : served.length === 0
          ? `${endpoint} serves nothing`
          : `${endpoint} serves ${served.join(", ")}`;
    super(
      `no usable model: ${requested} is not served and no frontier key is set. ${serving}. ` +
        "Pull the model into that runtime, point --local-endpoint at the runtime that has " +
        "it, or set ANTHROPIC_API_KEY, OPENAI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY so a " +
        "frontier model can answer instead.",
    );
    this.name = "NoUsableModelError";
  }
}

interface UsableModelRequest {
  readonly requested: string;
  /** Null when the requested model is not local, in which case there is nothing to check. */
  readonly preflight: LocalModelPreflight | null;
  readonly keys: FrontierKeys;
  /** Other models a calibration measured, preferred over an arbitrary served one. */
  readonly candidates: readonly string[];
}

function keyFor(modelSpec: string, keys: FrontierKeys): string | undefined {
  const provider = parseModelSpec(modelSpec).provider;
  if (provider === "anthropic") return keys.anthropic;
  if (provider === "openai") return keys.openai;
  if (provider === "google") return keys.google;
  return undefined;
}

export function chooseUsableModel(request: UsableModelRequest): UsableModel {
  const { requested, preflight, keys, candidates } = request;

  if (preflight === null) {
    return { outcome: "as-requested", modelSpec: requested, reason: "not a local model" };
  }

  const resolution = preflight.resolutions.find((entry) => entry.modelSpec === requested);

  // An unanswered probe is not a backend serving nothing. Excluding on no evidence would
  // route around a model that works, which is the opposite of the defect this exists for.
  if (resolution === undefined || resolution.outcome === "not-enumerated") {
    return {
      outcome: "as-requested",
      modelSpec: requested,
      reason: `${preflight.backendUrl} could not be asked what it serves, so nothing is excluded`,
    };
  }
  if (resolution.outcome !== "not-served") {
    return { outcome: "as-requested", modelSpec: requested, reason: "the backend serves it" };
  }

  const served = preflight.served ?? [];

  // A model this machine already holds beats one that costs money, and a calibrated
  // candidate beats an arbitrary served id because something is known about it.
  const measured = candidates.find(
    (candidate) =>
      candidate !== requested &&
      parseModelSpec(candidate).provider === "local" &&
      served.includes(parseModelSpec(candidate).modelId),
  );
  if (measured !== undefined) {
    return {
      outcome: "substituted",
      modelSpec: measured,
      requested,
      reason: `${requested} is not served by ${preflight.backendUrl}, which serves ${measured}, and a calibration measured it`,
    };
  }

  const [onlyServed] = served;
  if (served.length === 1 && onlyServed !== undefined) {
    return {
      outcome: "substituted",
      modelSpec: `local:${onlyServed}`,
      requested,
      reason: `${requested} is not served by ${preflight.backendUrl}, which serves only ${onlyServed}`,
    };
  }

  const frontier = frontierFallbackOrder.find((spec) => keyFor(spec, keys) !== undefined);
  if (frontier !== undefined) {
    return {
      outcome: "substituted",
      modelSpec: frontier,
      requested,
      reason: `${requested} is not served by ${preflight.backendUrl} and no served local model is a candidate, so a frontier key answers instead`,
    };
  }

  throw new NoUsableModelError(requested, preflight.served, preflight.backendUrl);
}
