import { z } from "zod";

/** The local runtimes this build knows how to start and talk to. */
export const localRuntimeNames = ["ollama", "rapid-mlx"] as const;

export type LocalRuntimeName = (typeof localRuntimeNames)[number];

interface LocalEndpointCandidate {
  readonly name: LocalRuntimeName;
  readonly baseUrl: string;
}

export interface DiscoveredLocalEndpoint extends LocalEndpointCandidate {
  readonly models: readonly string[];
}

/** Default ports for the two local runtimes the provider layer speaks to. */
export const defaultLocalEndpoints: readonly LocalEndpointCandidate[] = [
  { name: "ollama", baseUrl: "http://127.0.0.1:11434/v1" },
  { name: "rapid-mlx", baseUrl: "http://127.0.0.1:8000/v1" },
];

const modelListSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
});

interface ProbeResponse {
  readonly ok: boolean;
  json(): Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init?: { readonly signal?: AbortSignal },
) => Promise<ProbeResponse>;

interface DiscoveryDependencies {
  readonly fetch: FetchLike;
  readonly candidates?: readonly LocalEndpointCandidate[];
  readonly signal?: AbortSignal;
}

/**
 * Probes localhost for OpenAI-compatible model lists. A runtime that is not running is
 * an ordinary absence, not an error, so unreachable candidates are simply left out.
 */
export async function discoverLocalEndpoints(
  deps: DiscoveryDependencies,
): Promise<DiscoveredLocalEndpoint[]> {
  const candidates = deps.candidates ?? defaultLocalEndpoints;
  const probes = candidates.map((candidate) => probeEndpoint(candidate, deps));
  const results = await Promise.all(probes);
  return results.filter((endpoint): endpoint is DiscoveredLocalEndpoint => endpoint !== null);
}

async function probeEndpoint(
  candidate: LocalEndpointCandidate,
  deps: DiscoveryDependencies,
): Promise<DiscoveredLocalEndpoint | null> {
  try {
    const response = await deps.fetch(
      `${candidate.baseUrl}/models`,
      deps.signal === undefined ? undefined : { signal: deps.signal },
    );
    if (!response.ok) {
      return null;
    }
    const parsed = modelListSchema.safeParse(await response.json());
    if (!parsed.success) {
      return null;
    }
    return { ...candidate, models: parsed.data.data.map((entry) => entry.id) };
  } catch {
    return null;
  }
}
