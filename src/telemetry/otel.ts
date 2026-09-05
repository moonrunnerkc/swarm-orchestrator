import type { LoopEvent } from "../core/loop-events.ts";

/**
 * OpenTelemetry-shaped spans without an OpenTelemetry dependency.
 *
 * What a consumer needs from this is correctly named attributes on correctly shaped spans, and
 * the SDK is a large dependency for that. The generative-AI semantic conventions are also still
 * moving, so the schema version travels on every span: a collector reading these needs to know
 * which vocabulary it is reading, and a field that silently changes meaning between versions is
 * worse than one that is absent.
 *
 * Payload capture is off by default. Tool arguments are where the credentials are, and a
 * telemetry pipeline is exactly the place a secret ends up somewhere nobody scrubs.
 */
export const telemetrySchema = "v1";

export interface Span {
  readonly name: string;
  readonly startedAt: number;
  readonly status: "ok" | "error";
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
}

export interface SpanSink {
  emit(span: Span): void;
}

export interface SpanContext {
  readonly runId: string;
  readonly taskId?: string;
  readonly attemptId?: string;
  readonly at: number;
  /** Off by default: tool arguments are where the credentials are. */
  readonly capturePayloads?: boolean;
}

export function correlationFields(
  context: SpanContext,
): Readonly<Record<string, string | number | boolean>> {
  return {
    "swarm.run.id": context.runId,
    "swarm.telemetry.schema": telemetrySchema,
    ...(context.taskId === undefined ? {} : { "swarm.task.id": context.taskId }),
    ...(context.attemptId === undefined ? {} : { "swarm.attempt.id": context.attemptId }),
  };
}

export function spanFromEvent(event: LoopEvent, context: SpanContext): Span | null {
  const base = { startedAt: context.at, attributes: correlationFields(context) };

  switch (event.type) {
    case "model-call":
      return {
        ...base,
        name: "gen_ai.chat",
        status: "ok",
        attributes: {
          ...base.attributes,
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": event.modelId,
          "swarm.step": event.step,
        },
      };
    case "model-error":
      return {
        ...base,
        name: "gen_ai.chat",
        status: "error",
        attributes: {
          ...base.attributes,
          "gen_ai.operation.name": "chat",
          "swarm.step": event.step,
          "swarm.retry": event.willRetry,
          "error.type": "model_error",
        },
      };
    case "tool-call":
      return {
        ...base,
        name: "gen_ai.execute_tool",
        status: "ok",
        attributes: {
          ...base.attributes,
          "gen_ai.operation.name": "execute_tool",
          "gen_ai.tool.name": event.toolName,
          "swarm.tool.call_id": event.callId,
          ...(context.capturePayloads === true
            ? { "swarm.tool.arguments": JSON.stringify(event.input) }
            : {}),
        },
      };
    case "tool-outcome":
      return {
        ...base,
        name: "gen_ai.execute_tool",
        status: event.failed ? "error" : "ok",
        attributes: {
          ...base.attributes,
          "gen_ai.tool.name": event.toolName,
          "swarm.tool.call_id": event.callId,
          ...(context.capturePayloads === true ? { "swarm.tool.output": event.output } : {}),
        },
      };
    case "gate":
      return {
        ...base,
        name: "swarm.gate",
        status: event.status === "failed" ? "error" : "ok",
        attributes: {
          ...base.attributes,
          "swarm.gate.id": event.gateId,
          "swarm.gate.status": event.status,
          "swarm.gate.blocking": event.blocking,
          "swarm.evidence.record": event.record,
        },
      };
    case "stopped":
      return {
        ...base,
        name: "swarm.run",
        status: "ok",
        attributes: {
          ...base.attributes,
          "swarm.stop_reason": event.reason,
          "swarm.steps": event.steps,
          "gen_ai.usage.total_tokens": event.tokensUsed,
        },
      };
    default:
      // Everything else is for a person to read rather than for a collector to aggregate.
      return null;
  }
}

export interface Telemetry {
  observe(event: LoopEvent): void;
}

export function createTelemetry(options: {
  readonly enabled: boolean;
  readonly sink: SpanSink;
  readonly runId: string;
  readonly capturePayloads?: boolean;
  readonly now?: () => number;
}): Telemetry {
  return {
    observe(event) {
      if (!options.enabled) {
        return;
      }
      const span = spanFromEvent(event, {
        runId: options.runId,
        at: options.now?.() ?? Date.now(),
        ...(options.capturePayloads === undefined
          ? {}
          : { capturePayloads: options.capturePayloads }),
      });
      if (span !== null) {
        options.sink.emit(span);
      }
    },
  };
}

/** Writes each span as one line of JSON, which is what every collector's file receiver reads. */
export function jsonLinesSink(write: (line: string) => void): SpanSink {
  return { emit: (span) => write(`${JSON.stringify(span)}\n`) };
}
