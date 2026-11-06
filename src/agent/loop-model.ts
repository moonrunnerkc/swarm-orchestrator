import type { EvidenceRecorder } from "../evidence/session.ts";
import { estimateTokens } from "./context.ts";
import type { Usage } from "./loop-types.ts";
import { type Message, type ModelClient, ModelError, type Reply } from "./model.ts";
import { readReply } from "./prompt.ts";
import { withTurn } from "./usage.ts";

export type ModelTurn =
  | {
      readonly kind: "reply";
      readonly reply: Reply;
      readonly read: ReturnType<typeof readReply>;
      readonly usage: Usage;
    }
  | { readonly kind: "error"; readonly message: string; readonly usage: Usage };

/** One model call, its usage added, and its reply on the ledger before anything acts on it. */
export async function callModel(input: {
  readonly model: ModelClient;
  readonly messages: readonly Message[];
  readonly maxTokens: number;
  readonly prompt: number;
  readonly step: number;
  readonly usage: Usage;
  readonly evidence: EvidenceRecorder;
  readonly signal?: AbortSignal | undefined;
}): Promise<ModelTurn> {
  let reply: Reply;
  try {
    reply = await input.model.complete(input.messages, {
      signal: input.signal,
      maxTokens: input.maxTokens,
    });
  } catch (error) {
    if (!(error instanceof ModelError)) throw error;
    await input.evidence.record({
      type: "model-error",
      actor: "harness",
      provenance: ["tool-output"],
      payload: { step: input.step, error: error.message },
    });
    const usage = { ...input.usage, retries: input.usage.retries + error.retries };
    return { kind: "error", message: error.message, usage };
  }
  const usage = withTurn(input.usage, reply, input.prompt);
  const read = readReply(reply.content, reply.reasoning);
  await input.evidence.record({
    type: "model-call",
    actor: input.model.model,
    provenance: ["model"],
    payload: {
      step: input.step,
      reply: reply.content,
      ...(reply.reasoning === undefined ? {} : { reasoning: reply.reasoning }),
      ...(read.fromReasoning ? { replyFromReasoning: true } : {}),
      inputTokens: reply.inputTokens ?? input.prompt,
      outputTokens: reply.outputTokens ?? estimateTokens(reply.content),
      estimated: reply.inputTokens === null || reply.outputTokens === null,
      inferenceMs: reply.inferenceMs,
      retries: reply.retries,
    },
  });
  return { kind: "reply", reply, read, usage };
}
