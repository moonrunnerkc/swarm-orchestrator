import {
  type DiscoveredLocalEndpoint,
  defaultLocalEndpoints,
  type LocalRuntimeName,
} from "./local-discovery.ts";

/**
 * Which base URL serves local models, decided once per run and recorded: an explicit
 * endpoint from a flag, the environment, or swarm.toml always wins; otherwise discovery
 * probes both runtimes and the platform preference picks (rapid-mlx on Apple Silicon,
 * Ollama elsewhere). Nothing here ever falls back to a hardcoded URL: no runtime found
 * is an error that says how to fix it, not a guess that fails later.
 */

interface PinnedLocalEndpoint {
  readonly url: string;
  readonly origin: "flag" | "environment" | "config";
}

export type ResolvedLocalEndpoint =
  | {
      readonly chosen: "pinned";
      readonly url: string;
      readonly origin: PinnedLocalEndpoint["origin"];
      readonly reason: string;
    }
  | {
      readonly chosen: "discovered";
      readonly url: string;
      readonly runtime: LocalRuntimeName;
      readonly models: readonly string[];
      readonly reason: string;
    };

export class NoLocalEndpointError extends Error {
  constructor() {
    const targets = defaultLocalEndpoints
      .map((candidate) => `${candidate.name} at ${candidate.baseUrl}`)
      .join(" and ");
    super(
      `no local runtime is answering: probed ${targets}. ` +
        "Start Ollama or rapid-mlx, or name an endpoint explicitly with --local-endpoint, " +
        "SWARM_LOCAL_BASE_URL, or [providers] local_endpoint in swarm.toml.",
    );
    this.name = "NoLocalEndpointError";
  }
}

interface EndpointResolution {
  /** Null when no layer named one, which is what turns discovery on. */
  readonly pinned: PinnedLocalEndpoint | null;
  readonly discover: () => Promise<readonly DiscoveredLocalEndpoint[]>;
  readonly appleSilicon: boolean;
}

export async function resolveLocalEndpoint(
  resolution: EndpointResolution,
): Promise<ResolvedLocalEndpoint> {
  if (resolution.pinned !== null) {
    return {
      chosen: "pinned",
      url: resolution.pinned.url,
      origin: resolution.pinned.origin,
      reason: describePin(resolution.pinned.origin),
    };
  }

  const found = await resolution.discover();
  if (found.length === 0) {
    throw new NoLocalEndpointError();
  }

  const preferred: LocalRuntimeName = resolution.appleSilicon ? "rapid-mlx" : "ollama";
  const winner = found.find((endpoint) => endpoint.name === preferred) ?? found[0];
  if (winner === undefined) {
    throw new NoLocalEndpointError();
  }

  return {
    chosen: "discovered",
    url: winner.baseUrl,
    runtime: winner.name,
    models: winner.models,
    reason:
      winner.name === preferred
        ? `${winner.name} preferred ${resolution.appleSilicon ? "on" : "off"} Apple Silicon`
        : `${winner.name} is the only runtime answering`,
  };
}

function describePin(origin: PinnedLocalEndpoint["origin"]): string {
  if (origin === "flag") {
    return "pinned by flag";
  }
  if (origin === "environment") {
    return "pinned by SWARM_LOCAL_BASE_URL";
  }
  return "pinned by swarm.toml";
}

/** Type aliases rather than interfaces, so they stay assignable to the ledger's JSON type. */
type LocalEndpointEntry =
  | {
      type: "local-endpoint";
      actor: "harness";
      provenance: ["user"];
      payload: {
        chosen: "pinned";
        url: string;
        origin: PinnedLocalEndpoint["origin"];
        reason: string;
      };
    }
  | {
      type: "local-endpoint";
      actor: "harness";
      provenance: ["tool-output"];
      payload: {
        chosen: "discovered";
        url: string;
        runtime: LocalRuntimeName;
        models: string[];
        reason: string;
      };
    };

/**
 * The resolution as a ledger entry, so the bundle names the backend that actually served
 * the run. A pin is the user's decision; a discovery is a probe result, hence the tags.
 */
export function localEndpointRecord(resolved: ResolvedLocalEndpoint): LocalEndpointEntry {
  if (resolved.chosen === "pinned") {
    return {
      type: "local-endpoint",
      actor: "harness",
      provenance: ["user"],
      payload: {
        chosen: "pinned",
        url: resolved.url,
        origin: resolved.origin,
        reason: resolved.reason,
      },
    };
  }
  return {
    type: "local-endpoint",
    actor: "harness",
    provenance: ["tool-output"],
    payload: {
      chosen: "discovered",
      url: resolved.url,
      runtime: resolved.runtime,
      models: [...resolved.models],
      reason: resolved.reason,
    },
  };
}
