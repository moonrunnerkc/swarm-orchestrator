import { estimateTokens } from "./context.ts";
import type { LoopResult, TurnUsage, Usage } from "./loop-types.ts";
import type { Reply } from "./model.ts";

export const noUsage: Usage = {
  turns: 0,
  inputTokens: 0,
  outputTokens: 0,
  estimatedTurns: 0,
  inferenceMs: 0,
  inferenceTurns: 0,
  retries: 0,
  perTurn: [],
};

/**
 * The usage after one more turn: the runtime's counts where it reported them, otherwise the
 * estimate of the prompt sent and of the reply's text.
 */
export function withTurn(usage: Usage, reply: Reply, prompt: number): Usage {
  const turn: TurnUsage = {
    inputTokens: reply.inputTokens ?? prompt,
    outputTokens: reply.outputTokens ?? estimateTokens(reply.content),
    inputCount: reply.inputTokens === null ? "estimated" : "reported",
    outputCount: reply.outputTokens === null ? "estimated" : "reported",
    ...(reply.prefillMs == null ? {} : { prefillMs: reply.prefillMs }),
    ...(reply.outputMs == null ? {} : { generationMs: reply.outputMs }),
  };
  const estimated = turn.inputCount === "estimated" || turn.outputCount === "estimated";
  return {
    turns: usage.turns + 1,
    inputTokens: usage.inputTokens + turn.inputTokens,
    outputTokens: usage.outputTokens + turn.outputTokens,
    estimatedTurns: usage.estimatedTurns + (estimated ? 1 : 0),
    inferenceMs: usage.inferenceMs + (reply.inferenceMs ?? 0),
    inferenceTurns: usage.inferenceTurns + (reply.inferenceMs === null ? 0 : 1),
    retries: usage.retries + reply.retries,
    perTurn: [...usage.perTurn, turn],
  };
}

/** The loops' turns by requirement, summed across an escalation. */
export function turnsByRequirement(loops: readonly LoopResult[]): Record<string, number> {
  const total: Record<string, number> = {};
  for (const loop of loops)
    for (const [id, turns] of Object.entries(loop.turnsByRequirement))
      total[id] = (total[id] ?? 0) + turns;
  return total;
}

/** The loop turns' prefill and generation time, where every one of them reported it; else null. */
export function timings(loops: readonly LoopResult[]): {
  prefillMs: number | null;
  generationMs: number | null;
} {
  const turns = loops.flatMap((loop) => loop.usage.perTurn);
  const total = (pick: (turn: (typeof turns)[number]) => number | null | undefined) =>
    turns.length > 0 && turns.every((turn) => pick(turn) != null)
      ? turns.reduce((sum, turn) => sum + (pick(turn) ?? 0), 0)
      : null;
  return {
    prefillMs: total((turn) => turn.prefillMs),
    generationMs: total((turn) => turn.generationMs),
  };
}
