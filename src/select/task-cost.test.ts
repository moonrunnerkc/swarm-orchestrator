import { describe, expect, it } from "vitest";
import type { RecordedPayload } from "./calibration-measures.ts";
import { parsePricing } from "./pricing.ts";
import { costOfTask } from "./task-cost.ts";

const pricing = parsePricing(
  JSON.stringify({
    schemaVersion: 1,
    revision: "2026-08-14",
    rates: [{ model: "openai:gpt-5", inputPerMillionUsd: 2, outputPerMillionUsd: 10 }],
  }),
  "test",
);

function modelCall(inputTokens: number, outputTokens: number): RecordedPayload {
  return { type: "model-call", payload: { step: 1, inputTokens, outputTokens } };
}

const otherRecords: readonly RecordedPayload[] = [
  { type: "session-started", payload: { task: "t" } },
  { type: "gate-run", payload: { gateId: "tests" } },
];

describe("costOfTask", () => {
  it("prices recorded tokens against the model's rate and nothing else", () => {
    const cost = costOfTask({
      modelSpec: "openai:gpt-5",
      entries: [...otherRecords, modelCall(1_000_000, 100_000), modelCall(500_000, 0)],
      pricing,
    });

    // 1.5M input at $2/M plus 100k output at $10/M.
    expect(cost).toMatchObject({
      costUsd: 4,
      source: "priced",
      inputTokens: 1_500_000,
      outputTokens: 100_000,
      modelCalls: 2,
    });
    expect(cost.detail).toMatch(/2026-08-14/);
  });

  it("prices a local model at zero, with the source saying why", () => {
    const cost = costOfTask({
      modelSpec: "local:qwen3-coder:30b-a3b",
      entries: [modelCall(9_999, 9_999)],
      pricing,
    });

    expect(cost.costUsd).toBe(0);
    expect(cost.source).toBe("local");
  });

  it("treats the fixture provider as local: nothing was bought", () => {
    const cost = costOfTask({
      modelSpec: "fixture:worker",
      entries: [modelCall(10, 5)],
      pricing,
    });

    expect(cost).toMatchObject({ costUsd: 0, source: "local" });
  });

  it("records an unpriced frontier model as unknown, never as zero", () => {
    const cost = costOfTask({
      modelSpec: "openai:gpt-5-nano",
      entries: [modelCall(1_000, 1_000)],
      pricing,
    });

    expect(cost.costUsd).toBeNull();
    expect(cost.source).toBe("unknown");
    expect(cost.detail).toMatch(/no rate/);
  });

  it("counts a task with no model calls as costing nothing measurable", () => {
    const cost = costOfTask({ modelSpec: "openai:gpt-5", entries: otherRecords, pricing });

    expect(cost).toMatchObject({ costUsd: 0, source: "priced", modelCalls: 0 });
  });
});
