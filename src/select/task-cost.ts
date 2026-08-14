import type { RecordedPayload } from "./calibration-measures.ts";
import { type Pricing, rateFor } from "./pricing.ts";

/**
 * What one task cost, computed from the model-call records in its own ledger times the
 * model's published rate. Local and fixture models cost zero by rule. A frontier model
 * with no known rate costs unknown, never zero: zero is a measurement, unknown is not.
 */
export interface TaskCost {
  /** Null when the rate is unknown. The reward treats that as neutral, not as free. */
  readonly costUsd: number | null;
  readonly source: "priced" | "local" | "unknown";
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly modelCalls: number;
  /** Which rate priced it, or why nothing could. One line a reviewer reads in the bundle. */
  readonly detail: string;
}

export interface TaskCostInput {
  readonly modelSpec: string;
  /** The task's ledger entries; only model-call records carry tokens and only they count. */
  readonly entries: readonly RecordedPayload[];
  readonly pricing: Pricing;
}

export function costOfTask(input: TaskCostInput): TaskCost {
  let inputTokens = 0;
  let outputTokens = 0;
  let modelCalls = 0;

  for (const entry of input.entries) {
    if (entry.type !== "model-call") {
      continue;
    }
    modelCalls += 1;
    inputTokens += numberAt(entry.payload, "inputTokens");
    outputTokens += numberAt(entry.payload, "outputTokens");
  }

  const provider = input.modelSpec.split(":")[0];
  if (provider === "local" || provider === "fixture") {
    return {
      costUsd: 0,
      source: "local",
      inputTokens,
      outputTokens,
      modelCalls,
      detail: `${input.modelSpec} runs locally; the tokens were not bought`,
    };
  }

  const rate = rateFor(input.pricing, input.modelSpec);
  if (rate === null) {
    return {
      costUsd: null,
      source: "unknown",
      inputTokens,
      outputTokens,
      modelCalls,
      detail:
        `the ${input.pricing.revision} pricing table holds no rate for ${input.modelSpec}, ` +
        "so the cost is unknown rather than zero",
    };
  }

  const costUsd =
    (inputTokens * rate.inputPerMillionUsd + outputTokens * rate.outputPerMillionUsd) / 1_000_000;
  return {
    costUsd,
    source: "priced",
    inputTokens,
    outputTokens,
    modelCalls,
    detail:
      `priced by the ${input.pricing.revision} table: ` +
      `$${rate.inputPerMillionUsd}/M in, $${rate.outputPerMillionUsd}/M out`,
  };
}

function numberAt(payload: unknown, key: string): number {
  if (payload === null || typeof payload !== "object") {
    return 0;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
