import { describe, expect, it } from "vitest";
import type { JsonValue } from "../evidence/canonical-json.ts";
import type { RecordType } from "../evidence/ledger-record.ts";
import { type RecordedPayload, tallyModelCalls, tallyToolCalls } from "./calibration-measures.ts";

function toolCall(overrides: Record<string, JsonValue> = {}): RecordedPayload {
  return {
    type: "tool-call",
    payload: {
      callId: "call-1",
      toolName: "read",
      kind: "read",
      decision: "allowed",
      denial: null,
      ...overrides,
    },
  };
}

function modelCall(overrides: Record<string, JsonValue> = {}): RecordedPayload {
  return {
    type: "model-call",
    payload: {
      step: 1,
      outputTokens: 100,
      performance: { firstTokenMs: 200, outputTokensPerSecond: 50, responseTimeMs: 2_000 },
      ...overrides,
    },
  };
}

function ignored(type: RecordType): RecordedPayload {
  return { type, payload: { anything: true } };
}

describe("tallyToolCalls", () => {
  it("counts one attempt per call, not one per record", () => {
    // The chokepoint writes a requested record and then a settled one for every call.
    const tally = tallyToolCalls([
      toolCall({ decision: "requested" }),
      toolCall({ decision: "allowed" }),
    ]);

    expect(tally.attempted).toBe(1);
    expect(tally.validityRate).toBe(1);
  });

  it("counts a malformed call apart from one the guard refused", () => {
    const tally = tallyToolCalls([
      toolCall({ callId: "a", decision: "denied", denial: "invalid-input" }),
      toolCall({ callId: "b", decision: "denied", denial: "unknown-tool" }),
      toolCall({ callId: "c", decision: "denied", denial: "guard" }),
      toolCall({ callId: "d", decision: "allowed" }),
    ]);

    expect(tally).toMatchObject({ attempted: 4, malformed: 2 });
    expect(tally.validityRate).toBe(0.5);
  });

  it("counts the writes that applied against the writes attempted", () => {
    const tally = tallyToolCalls([
      toolCall({ callId: "a", kind: "write", decision: "allowed" }),
      toolCall({ callId: "b", kind: "write", decision: "failed" }),
      toolCall({ callId: "c", kind: "read", decision: "allowed" }),
    ]);

    expect(tally).toMatchObject({ writesAttempted: 2, writesApplied: 1 });
    expect(tally.applyRate).toBe(0.5);
  });

  it("reports no rate at all when nothing was attempted, rather than a perfect score", () => {
    const tally = tallyToolCalls([ignored("session-started")]);

    expect(tally).toMatchObject({ attempted: 0, validityRate: null, applyRate: null });
  });

  it("ignores records that are not tool calls", () => {
    expect(tallyToolCalls([ignored("gate-run"), modelCall()]).attempted).toBe(0);
  });
});

describe("tallyModelCalls", () => {
  it("adds up the output tokens and the time the calls took", () => {
    const tally = tallyModelCalls([
      modelCall({ outputTokens: 100 }),
      modelCall({
        outputTokens: 50,
        performance: { firstTokenMs: 100, outputTokensPerSecond: 25, responseTimeMs: 1_000 },
      }),
    ]);

    expect(tally).toMatchObject({ calls: 2, outputTokens: 150, responseTimeMs: 3_000 });
  });

  it("derives tokens per second from the totals over the whole repeat", () => {
    const tally = tallyModelCalls([modelCall({ outputTokens: 120 })]);

    expect(tally.tokensPerSecond).toBe(60);
  });

  it("takes the mean of the first-token times that were observed", () => {
    const tally = tallyModelCalls([
      modelCall(),
      modelCall({
        performance: { firstTokenMs: 400, outputTokensPerSecond: 50, responseTimeMs: 2_000 },
      }),
    ]);

    expect(tally.firstTokenMs).toBe(300);
  });

  it("skips a call whose first-token time nobody observed", () => {
    const tally = tallyModelCalls([
      modelCall(),
      modelCall({
        performance: { firstTokenMs: null, outputTokensPerSecond: null, responseTimeMs: 900 },
      }),
    ]);

    expect(tally.firstTokenMs).toBe(200);
  });

  it("reports nothing when no call observed a first token", () => {
    const tally = tallyModelCalls([
      modelCall({
        performance: { firstTokenMs: null, outputTokensPerSecond: null, responseTimeMs: 900 },
      }),
    ]);

    expect(tally.firstTokenMs).toBeNull();
  });

  it("reports no rate when no time was measured, rather than dividing by zero", () => {
    const tally = tallyModelCalls([
      modelCall({
        performance: { firstTokenMs: null, outputTokensPerSecond: null, responseTimeMs: 0 },
      }),
    ]);

    expect(tally.tokensPerSecond).toBeNull();
  });

  it("survives a record whose payload is not shaped like a model call", () => {
    expect(tallyModelCalls([{ type: "model-call", payload: { step: 1 } }])).toMatchObject({
      calls: 1,
      outputTokens: 0,
      firstTokenMs: null,
    });
  });
});
