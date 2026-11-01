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
