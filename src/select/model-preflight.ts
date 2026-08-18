import { parseModelSpec } from "../providers/model-spec.ts";
import type { ServedModel, ServedModelList } from "../providers/served-models.ts";

/**
 * Whether the backend that will serve a run is serving the models the run asks for, decided
 * before any of them is dispatched. A local model the backend does not hold fails at
 * dispatch, and a repeat that never dispatched measured nothing about that model, so
 * calibrating it would fill the ledger with runs that look like results and are not.
 */

export type ModelResolution =
  | { readonly modelSpec: string; readonly outcome: "not-local" }
  | {
      readonly modelSpec: string;
      readonly outcome: "served";
      readonly servedId: string;
      readonly matchedBy: "id" | "backend-mapping";
    }
  | { readonly modelSpec: string; readonly outcome: "not-served" }
  /** The backend could not be asked, so nothing is known and nothing is excluded. */
  | { readonly modelSpec: string; readonly outcome: "not-enumerated" };

export interface LocalModelPreflight {
  readonly backendUrl: string;
  readonly endpoint: string;
  /** What the backend reported, or null when it could not be asked. */
  readonly served: readonly string[] | null;
  readonly failure: string | null;
  readonly resolutions: readonly ModelResolution[];
  /** The requested models minus the ones the backend is known not to serve, in order. */
  readonly runnable: readonly string[];
  readonly excluded: readonly string[];
}

interface PreflightRequest {
  readonly requested: readonly string[];
  readonly backendUrl: string;
  readonly list: ServedModelList;
}

export function preflightLocalModels(request: PreflightRequest): LocalModelPreflight {
  const resolutions = request.requested.map((modelSpec) => resolveOne(modelSpec, request.list));

  return {
    backendUrl: request.backendUrl,
    endpoint: request.list.endpoint,
    served: request.list.enumerated ? request.list.models.map((model) => model.id) : null,
    failure: request.list.enumerated ? null : request.list.failure,
    resolutions,
    runnable: resolutions
      .filter((resolution) => resolution.outcome !== "not-served")
      .map((resolution) => resolution.modelSpec),
    excluded: resolutions
      .filter((resolution) => resolution.outcome === "not-served")
      .map((resolution) => resolution.modelSpec),
  };
}

function resolveOne(modelSpec: string, list: ServedModelList): ModelResolution {
  const spec = parseModelSpec(modelSpec);
  if (spec.provider !== "local") {
    return { modelSpec, outcome: "not-local" };
  }
  if (!list.enumerated) {
    return { modelSpec, outcome: "not-enumerated" };
  }

  const byId = list.models.find((served) => served.id === spec.modelId);
  if (byId !== undefined) {
    return { modelSpec, outcome: "served", servedId: byId.id, matchedBy: "id" };
  }

  const byMapping = list.models.find((served) => mapsTo(served, spec.modelId));
  if (byMapping !== undefined) {
    return { modelSpec, outcome: "served", servedId: byMapping.id, matchedBy: "backend-mapping" };
  }

  return { modelSpec, outcome: "not-served" };
}

/**
 * Equality against the mapping the backend published, and nothing else. A served alias and a
 * model path that merely share a word are two names, and guessing that they are one is how a
 * run ends up dispatching to a model nobody asked for.
 */
function mapsTo(served: ServedModel, modelId: string): boolean {
  return served.root === modelId || served.parent === modelId;
}

/** Type aliases rather than interfaces, so they stay assignable to the ledger's JSON type. */
type PreflightEntry = {
  type: "calibration-preflight";
  actor: "harness";
  provenance: ["tool-output"];
  payload: {
    backend: string;
    endpoint: string;
    enumerated: boolean;
    served: string[] | null;
    failure: string | null;
    requested: string[];
    runnable: string[];
    excluded: string[];
    models: { model: string; outcome: ModelResolution["outcome"]; servedId: string | null }[];
  };
};

/** The probe and its outcome as a ledger entry, so the exclusion is evidence rather than a line of output. */
export function preflightRecord(preflight: LocalModelPreflight): PreflightEntry {
  return {
    type: "calibration-preflight",
    actor: "harness",
    provenance: ["tool-output"],
    payload: {
      backend: preflight.backendUrl,
      endpoint: preflight.endpoint,
      enumerated: preflight.served !== null,
      served: preflight.served === null ? null : [...preflight.served],
      failure: preflight.failure,
      requested: preflight.resolutions.map((resolution) => resolution.modelSpec),
      runnable: [...preflight.runnable],
      excluded: [...preflight.excluded],
      models: preflight.resolutions.map((resolution) => ({
        model: resolution.modelSpec,
        outcome: resolution.outcome,
        servedId: resolution.outcome === "served" ? resolution.servedId : null,
      })),
    },
  };
}

/** What the run says out loud before it starts, so an exclusion is never silent. */
export function describePreflight(preflight: LocalModelPreflight): readonly string[] {
  const lines: string[] = [];

  if (preflight.served === null) {
    lines.push(
      `preflight: ${preflight.endpoint} could not say what it serves (${preflight.failure ?? "no reason given"}), ` +
        "so nothing was excluded on its word.",
    );
    return lines;
  }

  const served = preflight.served.length === 0 ? "nothing" : preflight.served.join(", ");
  for (const modelSpec of preflight.excluded) {
    lines.push(
      `preflight: ${modelSpec} is not served by ${preflight.backendUrl}, which reports serving ${served}. ` +
        "Excluded from calibration, with no runs created for it.",
    );
  }

  if (preflight.excluded.length > 0) {
    lines.push(
      `preflight: continuing with ${preflight.runnable.length} of ${preflight.resolutions.length} model(s) asked for.`,
    );
  }
  return lines;
}
