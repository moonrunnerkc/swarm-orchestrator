import { totalmem } from "node:os";
import type { InstalledModel } from "./ollama.ts";

const gib = 1024 ** 3;

export interface MemoryNeed {
  readonly weightsBytes: number;
  /** Keys and values for every layer at the configured context, at 16 bits each. */
  readonly kvCacheBytes: number;
  /** What the runtime holds besides: compute buffers and the graph. */
  readonly overheadBytes: number;
  readonly totalBytes: number;
}

/** The memory a model needs at `contextTokens`: weights, the full KV cache, and runtime overhead. */
export function memoryNeed(model: InstalledModel, contextTokens: number): MemoryNeed | null {
  if (model.sizeBytes === null || model.attention === null) return null;
  // A sliding-window layer keeps its window; every other layer keeps the whole context.
  const kvCacheBytes = model.attention.reduce(
    (sum, layer) =>
      sum +
      Math.min(contextTokens, layer.window ?? contextTokens) *
        layer.kvHeads *
        (layer.keyLength + layer.valueLength) *
        2,
    0,
  );
  const overheadBytes = 1 * gib;
  return {
    weightsBytes: model.sizeBytes,
    kvCacheBytes,
    overheadBytes,
    totalBytes: model.sizeBytes + kvCacheBytes + overheadBytes,
  };
}

/**
 * What a model may use: total memory less headroom for the operating system, the docker VM the
 * verifier runs checks in, and everything else the machine is doing. A quarter, and never less
 * than 8 GiB.
 */
export function modelMemoryBudget(total: number = totalmem()): number {
  return total - Math.max(8 * gib, total / 4);
}

export interface Eligibility {
  readonly model: InstalledModel;
  readonly eligible: boolean;
  /** Why it is or is not a candidate, in one line. */
  readonly reason: string;
  readonly need: MemoryNeed | null;
}

const format = (bytes: number) => `${(bytes / gib).toFixed(1)} GiB`;

/**
 * Which installed models can run the agent here, before anything is loaded: local weights, a
 * chat (completion) model, an attention shape the metadata states, a context at least the
 * configured one, and memory for weights and the full KV cache within the budget.
 */
export function eligibility(
  models: readonly InstalledModel[],
  contextTokens: number,
  budget = modelMemoryBudget(),
): Eligibility[] {
  return models.map((model) => {
    const no = (reason: string, need: MemoryNeed | null = null): Eligibility => ({
      model,
      eligible: false,
      reason,
      need,
    });
    if (model.remote) return no("served remotely, with no local weights");
    if (!model.capabilities.includes("completion"))
      return no(`not a chat model (${model.capabilities.join(", ") || "no capabilities listed"})`);
    if (model.capabilities.includes("embedding")) return no("an embedding model");
    if (model.contextLength !== null && model.contextLength < contextTokens) {
      return no(
        `its context is ${model.contextLength} tokens, under the configured ${contextTokens}`,
      );
    }
    const need = memoryNeed(model, contextTokens);
    if (need === null)
      return no(
        "its metadata does not state an attention shape, so its memory at the configured context cannot be estimated",
      );
    if (need.totalBytes > budget) {
      return no(
        `needs ${format(need.totalBytes)} (weights ${format(need.weightsBytes)}, KV cache ${format(need.kvCacheBytes)}) of a ${format(budget)} budget`,
        need,
      );
    }
    return {
      model,
      eligible: true,
      reason: `needs ${format(need.totalBytes)} (weights ${format(need.weightsBytes)}, KV cache ${format(need.kvCacheBytes)}) of a ${format(budget)} budget`,
      need,
    };
  });
}

/** The smallest context a run is worth starting with: the prompt, instructions and a few turns. */
const smallestUsefulContext = 8192;

/**
 * The step to take when no installed model fits, or null where one does (then the failure was a
 * probe, not capacity). The budget is fixed by total memory, so the steps are a smaller context
 * or a smaller model, never closing other programs. A suggested context passes the same rules as
 * the configured one, stated context included, and names the model selection would favor there.
 */
export function capacityAdvice(
  models: readonly InstalledModel[],
  contextTokens: number,
  budget = modelMemoryBudget(),
): string | null {
  const chat = models.filter(
    (one) =>
      !one.remote &&
      one.capabilities.includes("completion") &&
      !one.capabilities.includes("embedding"),
  );
  if (chat.length === 0) {
    return "no local chat model is installed: install one with `ollama pull <model>`, or name an OpenAI-compatible server with --endpoint";
  }
  if (chat.every((one) => one.attention === null || one.sizeBytes === null)) {
    return "the installed chat models state no attention shape, so their memory cannot be estimated: name one with --model to use it without the estimate";
  }
  const fitting = (context: number) =>
    eligibility(chat, context, budget)
      .filter((one) => one.eligible && one.need !== null)
      .sort(
        (a, b) =>
          (b.model.parameters ?? 0) - (a.model.parameters ?? 0) ||
          a.model.name.localeCompare(b.model.name),
      );
  if (fitting(contextTokens).length > 0) return null;
  const head = `no local chat model fits a ${contextTokens}-token context in the ${format(budget)} models may use here`;
  for (let context = contextTokens / 2; context >= smallestUsefulContext; context /= 2) {
    const [best] = fitting(context);
    if (best?.need) {
      return `${head}: run with --context ${context}, where ${best.model.name} fits (it needs ${format(best.need.totalBytes)}), or install a smaller chat model`;
    }
  }
  return `${head}, nor an ${smallestUsefulContext}-token one: install a smaller chat model`;
}
