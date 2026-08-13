import type { ZodType } from "zod";

/** Where a value entering a tool call came from (invariant 5). */
export type ProvenanceTag = "user" | "model" | "tool-output" | "file";

export interface ToolSchema {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ZodType;
}

export interface ModelToolCall {
  readonly callId: string;
  readonly toolName: string;
  readonly input: unknown;
}

export interface ToolCallOutcome {
  readonly callId: string;
  readonly toolName: string;
  readonly output: string;
  readonly failed: boolean;
}

/**
 * The loop's own transcript shape. Providers translate it at their boundary, so the
 * loop never depends on a vendor message format.
 */
export type ConversationMessage =
  | { readonly role: "user"; readonly text: string }
  | {
      readonly role: "assistant";
      readonly text: string;
      readonly toolCalls: readonly ModelToolCall[];
    }
  | { readonly role: "tool"; readonly outcomes: readonly ToolCallOutcome[] };

export interface ModelRequest {
  readonly system: string;
  readonly messages: readonly ConversationMessage[];
  readonly tools: readonly ToolSchema[];
  readonly maxOutputTokens: number;
  readonly abortSignal: AbortSignal;
}

export interface ModelResponse {
  readonly text: string;
  readonly toolCalls: readonly ModelToolCall[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly finishReason: string;
}

/** The model port. Providers implement it; the loop never imports a provider. */
export interface ModelClient {
  readonly modelId: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
}

export function describeUnknownError(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return String(cause);
}

export class ModelCallFailedError extends Error {
  readonly modelId: string;

  constructor(modelId: string, cause: unknown) {
    super(
      `model ${modelId} returned no response: ${describeUnknownError(cause)}. ` +
        "Check the provider endpoint and credentials, or select another model with --model.",
    );
    this.name = "ModelCallFailedError";
    this.modelId = modelId;
    this.cause = cause;
  }
}
