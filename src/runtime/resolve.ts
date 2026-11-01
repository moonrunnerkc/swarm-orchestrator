import { z } from "zod";
import { type ModelClient, openAiCompatible } from "../agent/model.ts";
import { capacityAdvice, eligibility } from "./capacity.ts";
import {
  type InstalledModel,
  listOllama,
  ollamaBase,
  ollamaChat,
  ollamaVersion,
} from "./ollama.ts";
import { probeModel } from "./probe.ts";
import {
  cachedProbe,
  type ProbeIdentity,
  profilePath,
  readProfile,
  withProbe,
  writeProfile,
} from "./profile.ts";
import { type Candidate, choose } from "./select.ts";

export interface ResolvedModel {
  readonly client: ModelClient;
  readonly name: string;
  readonly digest: string;
  readonly runtime: "ollama" | "openai-compatible";
  /** One line: why this model. */
  readonly reason: string;
  readonly cost: string;
  /** A stronger ready model for one escalation, or null. */
  readonly escalation: {
    readonly client: ModelClient;
    readonly name: string;
    readonly digest: string;
  } | null;
}

/** No model can run the agent here, with the exact step that would change that. */
export class NoModelError extends Error {
  constructor(problem: string, step: string) {
    super(`${problem}. ${step}`);
    this.name = "NoModelError";
  }
}

/** No installed model fits and passes its probe at the configured context. */
export class NoFittingModelError extends NoModelError {
  constructor(problem: string, step: string) {
    super(problem, step);
    this.name = "NoFittingModelError";
  }
}

/**
 * Resolves at the first of `contexts` at which a model fits: a larger context holds more of a
 * repository before compaction, and a machine where none fits there still runs at the next.
 * Only a failure to fit moves on; any other failure is the answer.
 */
export async function resolveAtContexts<T>(
  contexts: readonly number[],
  resolveAt: (contextTokens: number) => Promise<T>,
): Promise<{ readonly resolved: T; readonly contextTokens: number }> {
  let last: NoFittingModelError | null = null;
  for (const contextTokens of contexts) {
    try {
      return { resolved: await resolveAt(contextTokens), contextTokens };
    } catch (error) {
      if (!(error instanceof NoFittingModelError)) throw error;
      last = error;
    }
  }
  throw last ?? new NoModelError("no context to try", "pass --context");
}

export interface ResolveInput {
  /** A model name, or "auto". */
  readonly model: string;
  /** An OpenAI-compatible endpoint the user named, or null for Ollama. */
  readonly endpoint: string | null;
  readonly apiKey: string | null;
  readonly contextTokens: number;
  readonly home: string;
  readonly log: (line: string) => void;
}

const modelsSchema = z.object({ data: z.array(z.object({ id: z.string() })) });

/** The models an OpenAI-compatible endpoint serves; it states no weights, digests or shapes. */
async function endpointModels(endpoint: string, apiKey: string | null): Promise<string[]> {
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

/** Probes each candidate not already in the profile for its exact identity, strongest first. */
async function probed(
  models: readonly InstalledModel[],
  identityOf: (model: InstalledModel) => ProbeIdentity,
  clientOf: (model: InstalledModel) => ModelClient,
  input: ResolveInput,
  enough: (candidates: readonly Candidate[], next: InstalledModel | null) => boolean,
): Promise<Candidate[]> {
  const path = profilePath(input.home);
  let profile = await readProfile(path);
  const listed = eligibility(models, input.contextTokens).filter((one) => one.eligible);
  listed.sort((a, b) => (b.model.parameters ?? 0) - (a.model.parameters ?? 0));
  const candidates: Candidate[] = [];
  for (const [at, one] of listed.entries()) {
    const identity = identityOf(one.model);
    let result = cachedProbe(profile, identity);
    if (result === null) {
      input.log(`probing ${one.model.name} at a ${input.contextTokens}-token context`);
      result = await probeModel(clientOf(one.model), input.contextTokens);
      profile = withProbe(profile, identity, result);
      await writeProfile(path, profile);
    }
    candidates.push({ eligibility: one, probe: result });
    if (enough(candidates, listed[at + 1]?.model ?? null)) break;
  }
  return candidates;
}

/**
 * The model the run uses. A named model is used as named. `auto` discovers Ollama's installed
 * models (or the models a named endpoint serves), filters them by capacity before loading any,
 * probes the strongest until one is ready (each probe cached by model and runtime identity), and
 * picks by the profile's policy. Nothing is downloaded, and nothing remote is chosen.
 */
export async function resolveModel(input: ResolveInput): Promise<ResolvedModel> {
  const profile = await readProfile(profilePath(input.home));
  if (input.endpoint !== null && input.model !== "auto") {
    // Named on both counts: used as named, and a failure to answer ends the run like any other.
    const client = openAiCompatible({
      endpoint: input.endpoint,
      model: input.model,
      apiKey: input.apiKey,
    });
    return {
      client,
      name: input.model,
      digest: `${input.endpoint}#${input.model}`,
      runtime: "openai-compatible",
      reason: "named by --model",
      cost: "unknown: the endpoint reports no price",
      escalation: null,
    };
  }
  if (input.endpoint !== null) {
    const endpoint = input.endpoint;
    const served = await endpointModels(endpoint, input.apiKey);
    const name = input.model === "auto" ? served[0] : input.model;
    if (name === undefined)
      throw new NoModelError(`${endpoint} serves no model`, "Start the server with a model loaded");
    if (input.model === "auto" && served.length > 1) {
      throw new NoModelError(
        `${endpoint} serves ${served.length} models (${served.join(", ")})`,
        "Name one with --model",
      );
    }
    const client = openAiCompatible({ endpoint, model: name, apiKey: input.apiKey });
    const reason = input.model === "auto" ? `the one model ${endpoint} serves` : "named by --model";
    return {
      client,
      name,
      digest: `${endpoint}#${name}`,
      runtime: "openai-compatible",
      reason,
      cost: "unknown: the endpoint reports no price",
      escalation: null,
    };
  }
  const base = ollamaBase();
  const version = await ollamaVersion(base);
  if (version === null) {
    throw new NoModelError(
      `Ollama is not answering at ${base}`,
      "Start it with `ollama serve` (or open the Ollama app), or name an OpenAI-compatible server with --endpoint",
    );
  }
  const installed = await listOllama(base);
  const clientOf = (model: InstalledModel) =>
    ollamaChat({ base, model: model.name, contextTokens: input.contextTokens });
  if (input.model !== "auto") {
    const named = installed.find(
      (one) => one.name === input.model || one.name === `${input.model}:latest`,
    );
    if (named === undefined)
      throw new NoModelError(
        `Ollama has no model named ${input.model}`,
        `Install it with \`ollama pull ${input.model}\`, or pick one \`ollama list\` shows`,
      );
    return {
      client: clientOf(named),
      name: named.name,
      digest: named.digest,
      runtime: "ollama",
      reason: "named by --model",
      cost: "none (local runtime)",
      escalation: null,
    };
  }
  const identityOf = (model: InstalledModel): ProbeIdentity => ({
    runtime: "ollama",
    runtimeVersion: version,
    endpoint: base,
    model: model.name,
    digest: model.digest,
    quantization: model.quantization,
    contextTokens: input.contextTokens,
  });
  // A probe loads the model; unloading it at once keeps one model resident at a time.
  const probeClient = (model: InstalledModel) =>
    ollamaChat({ base, model: model.name, contextTokens: input.contextTokens, keepAlive: "0" });
  // Strongest first, until a ready model is found and the next is smaller: models tied at the top
  // are all probed, so the tie is settled by the policy rather than by listing order.
  const candidates = await probed(installed, identityOf, probeClient, input, (found, next) => {
    const ready = found.filter((one) => one.probe.ready);
    const best = Math.max(...ready.map((one) => one.eligibility.model.parameters ?? 0));
    return ready.length > 0 && (next === null || (next.parameters ?? 0) < best);
  });
  const choice = choose(candidates, profile, input.contextTokens);
  if (choice === null) {
    const tried = candidates
      .map((one) => `${one.eligibility.model.name}: ${one.probe.reason}`)
      .join("; ");
    // Nothing fit: say what would. Something fit and failed its probe: say which, and how to look.
    const advice = capacityAdvice(installed, input.contextTokens);
    throw new NoFittingModelError(
      `no installed Ollama model can run the agent at a ${input.contextTokens}-token context${tried.length > 0 ? ` (${tried})` : ""}`,
      advice === null
        ? "Every model that fits failed its readiness probe: `swarm doctor --models` shows each one's result; name one with --model to use it anyway"
        : `${advice[0]?.toUpperCase()}${advice.slice(1)}`,
    );
  }
  const model = choice.chosen.eligibility.model;
  const escalation = choice.escalation === null ? null : choice.escalation.eligibility.model;
  return {
    client: clientOf(model),
    name: model.name,
    digest: model.digest,
    runtime: "ollama",
    reason: choice.reason,
    cost: "none (local runtime)",
    escalation:
      escalation === null
        ? null
        : { client: clientOf(escalation), name: escalation.name, digest: escalation.digest },
  };
}
