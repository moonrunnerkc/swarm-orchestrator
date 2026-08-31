import { describe, expect, it } from "vitest";
import { classifyTurn, failedTurnContent, turnContentPayload } from "./turn-content.ts";

describe("whether a turn carried anything", () => {
  it("reads text as content", () => {
    expect(classifyTurn({ text: "done", toolCalls: [] })).toEqual({
      textCharacters: 4,
      toolCalls: 0,
      empty: false,
      emptyReason: null,
    });
  });

  it("reads a tool call as content even with no text beside it", () => {
    expect(classifyTurn({ text: "", toolCalls: [{}] })).toMatchObject({
      empty: false,
      emptyReason: null,
    });
  });

  it("reads a turn of whitespace as a turn of nothing, and says which nothing it was", () => {
    expect(classifyTurn({ text: "  \n\t", toolCalls: [] })).toEqual({
      textCharacters: 0,
      toolCalls: 0,
      empty: true,
      emptyReason: "whitespace-only-text",
    });
  });

  it("separates a turn that arrived empty from one that never arrived", () => {
    expect(classifyTurn({ text: "", toolCalls: [] }).emptyReason).toBe("no-content");
    expect(failedTurnContent.emptyReason).toBe("call-failed");
  });

  it("renders flat, so a predicate can reach each field of it", () => {
    expect(turnContentPayload(classifyTurn({ text: " x ", toolCalls: [] }))).toEqual({
      textCharacters: 1,
      toolCalls: 0,
      empty: false,
      emptyReason: null,
    });
  });
});
