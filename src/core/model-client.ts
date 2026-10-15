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
  /**
   * Called with each piece of a tool call's arguments as it streams, for the same watcher
   * that reads `onText`. A model that spirals inside a tool call's arguments produces no text
   * at all, so a watcher reading text alone saw nothing until the output cap ended the call:
   * one live call spent eight minutes streaming a shell argument that was then unreadable.
   */
  readonly onToolInput?: (text: string) => void;
  /**
   * Called with each piece of reasoning a model streams before its answer, for the same
   * watcher. A reasoning model that spirals in its thinking produces neither text nor a tool
   * call until the cap; the deltas are the only place the spiral shows while it is happening.
   */
  readonly onReasoning?: (text: string) => void;
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
  readonly usageStatus?: "reported" | "unknown";
  readonly providerAttempts?: readonly {
    outcome: "response" | "rejected";
    statusCode: number | null;
    usage: "reported" | "unknown";
  }[];
  readonly text: string;
  readonly toolCalls: readonly ModelToolCall[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  /**
   * Reasoning tokens inside the output and cached tokens inside the input, where the provider
   * reports them; null where it does not. Kept apart from the totals they are part of, so a
   * run's account can say how much of its spend was thinking and how much was replayed prefix
   * without adding either twice.
   */
  readonly reasoningTokens?: number | null;
  readonly cachedInputTokens?: number | null;
  readonly finishReason: string;
  readonly performance: ModelPerformance;
  /**
   * What the provider reported it could not apply, by the name the provider used. Empty is
   * the ordinary case and means everything the request asked for was taken.
   *
   * Here for the seed above. A seed recorded as though it made a run re-derivable, against a
   * backend that dropped it, is a claim about replay that nothing checked: two calibration
   * runs over the same golden set with the same per-repeat seeds picked two different models,
   * and neither ledger said whether the seed had reached the sampler at all.
   */
  readonly unsupportedFeatures: readonly string[];
}

/** For providers and doubles that have no timings to report. */
export const unobservedPerformance: ModelPerformance = {
  firstTokenMs: null,
  outputTokensPerSecond: null,
  responseTimeMs: 0,
};

/** The model port. Providers implement it; the loop never imports a provider. */
export interface ModelClient {
  /** Harness wrappers that persist abort outcomes settle only after that recording is durable. */
  readonly recordsCancellation?: boolean;
  readonly modelId: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
}

/**
 * What went wrong, including what it was caused by.
 *
 * Reading only the top message threw away the sentence that says what to do: a local endpoint
 * that closes a connection surfaces through fetch as an Error whose whole message is
 * "terminated", and everything distinguishing a timeout from a dropped socket from a refused
 * connection sits in `cause`. A person reading "terminated" cannot act on it, and neither
 * could the run that recorded it.
 */
export function describeUnknownError(cause: unknown): string {
  const parts: string[] = [];
  let current: unknown = cause;

  // Bounded: a cycle in a cause chain would otherwise spin here rather than fail.
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth += 1) {
    const message = current instanceof Error ? current.message : describeValue(current);
    if (message.length > 0 && !parts.includes(message)) {
      parts.push(message);
    }
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && !parts.includes(code)) {
      parts.push(code);
    }
    current =
      current instanceof Error
        ? current.cause
        : typeof current === "object"
          ? (current as { cause?: unknown }).cause
          : undefined;
  }

  return parts.length === 0 ? describeValue(cause) : parts.join(", caused by ");
}

/** How much of an unknown error value is kept: enough to act on, never a transcript. */
const describedValueCap = 400;

/**
 * A thrown value that is not an Error, said rather than stringified. A local server's error
 * body arrives as a plain object (`{ error: { message, type } }` or `{ message }`) and
 * `String(object)` is "[object Object]", which is what three repair calls of a live run
 * recorded as their whole account of failing.
 */
function describeValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return String(value);
  const record = value as Record<string, unknown>;
  const nested = record.error;
  const message =
    typeof record.message === "string"
      ? record.message
      : nested !== null && typeof nested === "object"
        ? (nested as { message?: unknown }).message
        : typeof nested === "string"
          ? nested
          : undefined;
  const status = record.status ?? record.statusCode;
  const statusText = record.statusText;
  const head = [
    typeof message === "string" ? message : null,
    typeof status === "number" || typeof status === "string" ? `status ${status}` : null,
    typeof statusText === "string" ? statusText : null,
  ].filter((part): part is string => part !== null);
  if (head.length > 0) return head.join(", ");
  try {
    const json = JSON.stringify(value);
    if (json === undefined || json === "{}") return "an error carrying no message";
    return json.length > describedValueCap ? `${json.slice(0, describedValueCap)}...` : json;
  } catch {
    return "an error that cannot be described";
  }
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
