import { z } from "zod";
import type { MemoryProbe } from "./calibration-run.ts";

const loadedModelsSchema = z.object({
  models: z.array(z.object({ name: z.string(), size: z.number().nonnegative() })).min(1),
});

interface ProbeResponse {
  readonly ok: boolean;
  json(): Promise<unknown>;
}

type MemoryFetch = (url: string) => Promise<ProbeResponse>;

interface OllamaMemoryProbeOptions {
  /** The OpenAI-compatible base url the provider layer talks to. */
  readonly baseUrl: string;
  readonly fetch: MemoryFetch;
}

/** Ollama reports what it has resident on its own API, not on the OpenAI-compatible one. */
export function nativeEndpointFor(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "")}/api/ps`;
}

/**
 * Peak memory, as far as anything can report it: the largest model the runtime is holding
 * resident. Summing what is loaded would count a model this run never touched, and a runtime
 * that reports nothing gives null rather than a zero that would read as a measurement.
 */
export function createOllamaMemoryProbe(options: OllamaMemoryProbeOptions): MemoryProbe {
  const endpoint = nativeEndpointFor(options.baseUrl);

  return async () => {
    try {
      const response = await options.fetch(endpoint);
      if (!response.ok) {
        return null;
      }
      const parsed = loadedModelsSchema.safeParse(await response.json());
      if (!parsed.success) {
        return null;
      }
      return Math.max(...parsed.data.models.map((model) => model.size));
    } catch {
      return null;
    }
  };
}
