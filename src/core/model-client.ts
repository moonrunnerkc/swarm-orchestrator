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

/**
 * Decoding settings, sent on the wire rather than left to whatever the backend defaults to,
 * so a measurement says what it was taken under. Absent means nothing is sent and the
 * backend's own defaults stand, which is what the ordinary agent path does.
 */
export interface SamplingSettings {
  readonly temperature: number;
  readonly topP: number;
  /**
   * Recorded per call where the backend takes one, null where it does not. A seed makes a
   * repeat re-derivable; it is deliberately different per repeat, because a calibration run
   * is measuring a distribution rather than reproducing a point.
   */
  readonly seed: number | null;
}

export interface ModelRequest {
  readonly system: string;
  readonly messages: readonly ConversationMessage[];
  readonly tools: readonly ToolSchema[];
  readonly maxOutputTokens: number;
  readonly sampling?: SamplingSettings;
  readonly abortSignal: AbortSignal;
  /**
   * Called with each piece of text as it arrives, for a screen that would otherwise sit on
   * "thinking" for a minute with nothing to show. Absent is the ordinary case: the stream was
   * already being drained to time the first token, and this only stops discarding what it saw.
   * Nothing downstream reads it, so what the loop records is still the whole response.
   */
  readonly onText?: (text: string) => void;
}

/**
 * What the call cost in time. Measured by the provider, which is the only layer that sees the
 * response arrive; a wrapper timing `generate` can only ever report the whole call. Null means
 * the provider could not observe that number, stated rather than omitted so an unmeasured
 * dimension never reads as a zero.
 */
export interface ModelPerformance {
  /** Milliseconds from the request to the first output token, tool calls included. */
  readonly firstTokenMs: number | null;
  /** Output tokens per second after the first token arrived. */
  readonly outputTokensPerSecond: number | null;
  /** Wall time of the whole call. */
  readonly responseTimeMs: number;
}

export interface ModelResponse {
  readonly text: string;
  readonly toolCalls: readonly ModelToolCall[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly finishReason: string;
  readonly performance: ModelPerformance;
}

/** For providers and doubles that have no timings to report. */
export const unobservedPerformance: ModelPerformance = {
  firstTokenMs: null,
  outputTokensPerSecond: null,
  responseTimeMs: 0,
};

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
