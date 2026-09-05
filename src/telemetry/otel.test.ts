import { describe, expect, it } from "vitest";
import {
  correlationFields,
  createTelemetry,
  jsonLinesSink,
  type SpanSink,
  spanFromEvent,
} from "./otel.ts";

function recordingSink(): SpanSink & { readonly spans: unknown[] } {
  const spans: unknown[] = [];
  return { spans, emit: (span) => spans.push(span) };
}

describe("what a run reports to a collector", () => {
  it("names a model call with the conventional generative-ai attributes", () => {
    const span = spanFromEvent(
      { type: "model-call", step: 3, modelId: "local:qwen3.6:35b-a3b" },
      { runId: "r1", taskId: "t1", attemptId: "a1", at: 100 },
    );

    expect(span?.name).toBe("gen_ai.chat");
    expect(span?.attributes["gen_ai.request.model"]).toBe("local:qwen3.6:35b-a3b");
    expect(span?.attributes["swarm.run.id"]).toBe("r1");
    expect(span?.attributes["swarm.step"]).toBe(3);
  });

  it("names a tool call as a tool execution, not as a model call", () => {
    const span = spanFromEvent(
      { type: "tool-call", callId: "c1", toolName: "shell", input: { command: "ls" } },
      { runId: "r1", at: 100 },
    );

    expect(span?.name).toBe("gen_ai.execute_tool");
    expect(span?.attributes["gen_ai.tool.name"]).toBe("shell");
  });

  it("carries no tool input by default, because that is where the secrets are", () => {
    const span = spanFromEvent(
      { type: "tool-call", callId: "c1", toolName: "shell", input: { command: "cat .env" } },
      { runId: "r1", at: 100 },
    );

    expect(JSON.stringify(span)).not.toContain(".env");
  });

  it("carries the payload only where a caller turned it on", () => {
    const span = spanFromEvent(
      { type: "tool-call", callId: "c1", toolName: "shell", input: { command: "ls" } },
      { runId: "r1", at: 100, capturePayloads: true },
    );

    expect(JSON.stringify(span)).toContain("ls");
  });

  it("marks a failed gate span as an error rather than reporting it as ordinary", () => {
    const span = spanFromEvent(
      {
        type: "gate",
        gateId: "tests",
        status: "failed",
        blocking: true,
        detail: "1 failed",
        record: "sha256:aa",
      },
      { runId: "r1", at: 100 },
    );

    expect(span?.status).toBe("error");
    expect(span?.attributes["swarm.gate.id"]).toBe("tests");
  });

  it("puts the same correlation on every span, so a trace can be assembled", () => {
    expect(correlationFields({ runId: "r1", taskId: "t1", attemptId: "a1", at: 0 })).toMatchObject({
      "swarm.run.id": "r1",
      "swarm.task.id": "t1",
      "swarm.attempt.id": "a1",
    });
  });

  it("emits nothing at all when telemetry is off, which is the default", () => {
    const sink = recordingSink();
    createTelemetry({ enabled: false, sink, runId: "r1" }).observe({
      type: "model-call",
      step: 1,
      modelId: "m",
    });

    expect(sink.spans).toHaveLength(0);
  });

  it("emits when it is on", () => {
    const sink = recordingSink();
    createTelemetry({ enabled: true, sink, runId: "r1" }).observe({
      type: "model-call",
      step: 1,
      modelId: "m",
    });

    expect(sink.spans).toHaveLength(1);
  });

  it("names its own schema version, because these conventions are still moving", () => {
    const span = spanFromEvent(
      { type: "model-call", step: 1, modelId: "m" },
      { runId: "r1", at: 0 },
    );

    expect(span?.attributes["swarm.telemetry.schema"]).toMatch(/^v\d+$/);
  });

  it("writes one line per span, which is what a file receiver reads", () => {
    const lines: string[] = [];
    jsonLinesSink((line) => lines.push(line)).emit({
      name: "swarm.gate",
      startedAt: 0,
      status: "ok",
      attributes: {},
    });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}").name).toBe("swarm.gate");
  });

  it("reports what a person reads as nothing a collector aggregates", () => {
    // Plan text and model prose belong on a screen, not in a metrics pipeline.
    expect(
      spanFromEvent({ type: "plan", text: "do the thing" }, { runId: "r1", at: 0 }),
    ).toBeNull();
  });
});
