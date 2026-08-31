import { describe, expect, it } from "vitest";
import type { JsonValue } from "../evidence/canonical-json.ts";
import type { RecordType } from "../evidence/ledger-record.ts";
import {
  type RecordedPayload,
  tallyModelCalls,
  tallyToolCalls,
  tallyTurnContent,
} from "./calibration-measures.ts";

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

  it("counts a malformed call apart from one the sandbox refused", () => {
    const tally = tallyToolCalls([
      toolCall({ callId: "a", decision: "denied", denial: "invalid-input" }),
      toolCall({ callId: "b", decision: "denied", denial: "unknown-tool" }),
      toolCall({ callId: "c", decision: "denied", denial: "sandbox" }),
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

describe("what the model-call records say about their own turns", () => {
  function turn(content: JsonValue): RecordedPayload {
    return { type: "model-call", payload: { step: 1, content } };
  }

  it("counts a turn the harness read as carrying something", () => {
    const tally = tallyTurnContent([
      turn({ textCharacters: 4, toolCalls: 0, empty: false, emptyReason: null }),
    ]);

    expect(tally).toMatchObject({ turns: 1, answered: 1, empty: 0, unread: 0 });
  });

  it("keeps the reason codes apart, so an abstention can name which emptiness it was", () => {
    const tally = tallyTurnContent([
      turn({ textCharacters: 0, toolCalls: 0, empty: true, emptyReason: "no-content" }),
      turn({ textCharacters: 0, toolCalls: 0, empty: true, emptyReason: "whitespace-only-text" }),
      turn({ textCharacters: 0, toolCalls: 0, empty: true, emptyReason: "no-content" }),
    ]);

    expect(tally.empty).toBe(3);
    expect(tally.emptyReasons).toEqual({ "no-content": 2, "whitespace-only-text": 1 });
  });

  it("never reads a record with no harness reading as an answered turn", () => {
    // The direction matters: a record that does not say whether the turn held anything is
    // absence of evidence, and counting it as answered is how an unmeasured run reads green.
    const tally = tallyTurnContent([
      { type: "model-call", payload: { step: 1 } },
      turn({ empty: "yes" }),
    ]);

    expect(tally).toMatchObject({ turns: 2, answered: 0, empty: 0, unread: 2 });
  });

  it("counts nothing off records that are not model calls", () => {
    expect(
      tallyTurnContent([{ type: "gate-run", payload: { content: { empty: false } } }]),
    ).toEqual({ turns: 0, answered: 0, empty: 0, unread: 0, emptyReasons: {} });
  });
});
