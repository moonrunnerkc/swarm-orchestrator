import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ModelClient, ModelRequest, ModelResponse, ToolSchema } from "../core/model-client.ts";
import { unobservedPerformance } from "../core/model-client.ts";
import { canaryRecord, describeCanary, runBackendCanary } from "./backend-canary.ts";

const tools: readonly ToolSchema[] = [
  {
    name: "list",
    description: "List the entries of a workspace directory.",
    inputSchema: z.object({ path: z.string().optional() }),
  },
];

function answering(responses: readonly Partial<ModelResponse>[]): ModelClient {
  let played = 0;
  return {
    modelId: "local:served",
    generate(_request: ModelRequest): Promise<ModelResponse> {
      const one = responses[Math.min(played, responses.length - 1)];
      played += 1;
      return Promise.resolve({
        text: "",
        toolCalls: [],
        inputTokens: 10,
        outputTokens: 5,
        finishReason: "stop",
        performance: unobservedPerformance,
        unsupportedFeatures: [],
        ...one,
      });
    },
  };
}

function canary(model: ModelClient, attempts = 3) {
  return runBackendCanary({
    modelSpec: "local:served",
    model,
    tools,
    attempts,
    abortSignal: new AbortController().signal,
  });
}

describe("runBackendCanary", () => {
  it("passes a runtime that returns a call the chokepoint could act on", async () => {
    const result = await canary(
      answering([{ toolCalls: [{ callId: "c1", toolName: "list", input: { path: "." } }] }]),
    );

    expect(result.healthy).toBe(true);
    expect(result.wellFormed).toBe(3);
    expect(result.attempts.every((one) => one.problem === null)).toBe(true);
  });

  /**
   * The failure this exists for. A local runtime resident for hours started answering with
   * neither text nor a call: usage reported output tokens, the stream carried none of them.
   * Sixty golden-set runs then measured that silence and scored it against the model.
   */
  it("fails a runtime that returns nothing at all", async () => {
    const result = await canary(answering([{ text: "", toolCalls: [] }]));

    expect(result.healthy).toBe(false);
    expect(result.wellFormed).toBe(0);
    expect(result.attempts[0]?.problem).toBe("no tool call came back");
  });

  it("fails a runtime whose tool name arrives with generation debris welded to it", async () => {
    const result = await canary(
      answering([
        { toolCalls: [{ callId: "c1", toolName: "list\n</\n<function", input: { path: "." } }] },
      ]),
    );

    expect(result.healthy).toBe(false);
    expect(result.attempts[0]?.problem).toMatch(/no tool is named/);
  });

  it("fails a runtime whose arguments do not match the tool's schema", async () => {
    const result = await canary(
      answering([{ toolCalls: [{ callId: "c1", toolName: "list", input: { path: 7 } }] }]),
    );

    expect(result.healthy).toBe(false);
    expect(result.attempts[0]?.problem).toMatch(/did not match its schema/);
  });

  it("records a dispatch failure as an attempt rather than throwing out of the canary", async () => {
    const result = await canary({
      modelId: "local:served",
      generate: () => Promise.reject(new Error("connection reset")),
    });

    expect(result.healthy).toBe(false);
    expect(result.attempts[0]?.problem).toMatch(/connection reset/);
  });

  /**
   * One clean call is the whole bar. The canary rules out a runtime that cannot form a call
   * at all; grading the model is what the calibration itself is for, and a bar needing every
   * attempt clean would reject a merely mediocre model before it was ever measured.
   */
  it("passes when one attempt of three is clean, since it is not a quality bar", async () => {
    let call = 0;
    const result = await canary({
      modelId: "local:served",
      generate: () => {
        call += 1;
        return Promise.resolve({
          text: "",
          toolCalls: call === 2 ? [{ callId: "c1", toolName: "list", input: { path: "." } }] : [],
          inputTokens: 10,
          outputTokens: 5,
          finishReason: "stop",
          performance: unobservedPerformance,
          unsupportedFeatures: [],
        });
      },
    });

    expect(result.healthy).toBe(true);
    expect(result.wellFormed).toBe(1);
  });
});

describe("canaryRecord", () => {
  it("records every attempt, what came back, and the verdict", async () => {
    const record = canaryRecord(await canary(answering([{ text: "", toolCalls: [] }]), 2));

    expect(record.type).toBe("calibration-canary");
    expect(record.provenance).toEqual(["tool-output"]);
    expect(record.payload).toMatchObject({
      model: "local:served",
      attempts: 2,
      wellFormed: 0,
      healthy: false,
    });
    expect(record.payload.results).toHaveLength(2);
  });
});

describe("describeCanary", () => {
  it("says how many came back clean, and names the remedy when none did", async () => {
    const printed = describeCanary(await canary(answering([{ text: "", toolCalls: [] }]))).join(
      "\n",
    );

    expect(printed).toContain("0 of 3 trivial tool call(s) came back well formed");
    expect(printed).toContain("Restart the local runtime");
  });

  it("names no remedy when the backend can form a call", async () => {
    const printed = describeCanary(
      await canary(answering([{ toolCalls: [{ callId: "c1", toolName: "list", input: {} }] }])),
    ).join("\n");

    expect(printed).toContain("3 of 3");
    expect(printed).not.toContain("Restart");
  });
});
