import { z } from "zod";
import { type ModelClient, openAiCompatible } from "../agent/model.ts";
import { type InstalledModel, parameterCount } from "./ollama.ts";
import { probeModel } from "./probe.ts";
import { cachedProbe, modelRecord, type ProbeIdentity, withProbe } from "./profile.ts";
import { NoModelError, type ResolvedModel, type ResolveInput } from "./resolve.ts";
import type { Candidate } from "./select.ts";

const modelsSchema = z.object({ data: z.array(z.object({ id: z.string() })) });

/** The models an OpenAI-compatible endpoint serves; it states no weights, digests or shapes. */
export async function endpointModels(endpoint: string, apiKey: string | null): Promise<string[]> {
  const response = await fetch(`${endpoint.replace(/\/+$/, "")}/models`, {
    headers: apiKey === null ? {} : { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  }).catch((error: unknown) => {
    throw new NoModelError(
      `nothing answers at ${endpoint} (${error instanceof Error ? error.message : String(error)})`,
      "Start the server, or check the address passed with --endpoint",
    );
  });
  if (!response.ok)
    throw new NoModelError(
      `${endpoint}/models answered HTTP ${response.status}`,
      "Check the address passed with --endpoint",
    );
  return modelsSchema.parse(await response.json()).data.map((one) => one.id);
}

/** The one configured endpoint's model as a probed candidate, or null where it does not answer. */
export async function endpointCandidate(
  endpoint: string,
  input: ResolveInput,
): Promise<{ readonly candidate: Candidate; readonly client: ModelClient } | null> {
  const served = await endpointModels(endpoint, input.apiKey).catch((error: unknown) => {
    input.log(
      `not considering ${endpoint}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  });
  const name = served?.length === 1 ? served[0] : undefined;
  if (name === undefined) {
    if (served !== null)
      input.log(`not considering ${endpoint}: it serves ${served.length} models`);
    return null;
  }
  const client = openAiCompatible({ endpoint, model: name, apiKey: input.apiKey });
  const model: InstalledModel = {
    runtime: "openai-compatible",
    name,
    digest: `${endpoint}#${name}`,
    sizeBytes: null,
    quantization: null,
    parameters: parameterCount(name),
    family: null,
    capabilities: [],
    remote: false,
    contextLength: null,
    attention: null,
  };
  const identity: ProbeIdentity = {
    runtime: "openai-compatible",
    runtimeVersion: "unknown",
    endpoint,
    model: name,
    digest: model.digest,
    quantization: null,
    contextTokens: input.contextTokens,
  };
  const record = input.record ?? modelRecord(input.home);
  const profile = await record.read();
  let probe = cachedProbe(profile, identity);
  if (probe === null) {
    input.log(`probing ${name} at ${endpoint} at a ${input.contextTokens}-token context`);
    probe = await probeModel(client, input.contextTokens);
    await record.write(withProbe(profile, identity, probe));
  }
  // Served already: its weights are resident in the server, so no capacity is estimated.
  const eligibility = { model, eligible: true, reason: `served at ${endpoint}`, need: null };
  return { candidate: { eligibility, probe }, client };
}

/** One candidate as the run's model, where it is the only one there is. */
export function single(
  served: { readonly candidate: Candidate; readonly client: ModelClient },
  reason: string,
): ResolvedModel {
  const model = served.candidate.eligibility.model;
  if (!served.candidate.probe.ready)
    throw new NoModelError(
      `${model.name} failed its readiness probe: ${served.candidate.probe.reason}`,
      "Start Ollama, or name a model with --model",
    );
  return {
    client: served.client,
    name: model.name,
    digest: model.digest,
    runtime: "openai-compatible",
    reason,
    cost: "unknown: the endpoint reports no price",
    alternatives: [],
  };
}
