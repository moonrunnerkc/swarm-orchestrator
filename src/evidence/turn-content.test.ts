import { describe, expect, it } from "vitest";
import { classifyTurnContent } from "./turn-content.ts";

const turn = (over: Partial<Parameters<typeof classifyTurnContent>[0]>) =>
  classifyTurnContent({ text: "", toolCalls: [], finishReason: "stop", ...over });

describe("what counts as a turn that carried something", () => {
  it("takes text as content", () => {
    expect(turn({ text: "done" })).toEqual({ valid: true, reason: null });
  });

  it("takes a tool call as content, whatever the text says", () => {
    expect(turn({ text: "", toolCalls: [{ toolName: "read" }] })).toEqual({
      valid: true,
      reason: null,
    });
  });

  it("reads an empty turn as empty", () => {
    expect(turn({})).toEqual({ valid: false, reason: "no-content" });
  });

  it("reads a whitespace-only turn as empty, and says which kind of empty", () => {
    expect(turn({ text: "  \n\t " })).toEqual({ valid: false, reason: "whitespace-only-text" });
  });

  it("names the cap separately from the silence", () => {
    // Observed on both corrupt bundles: finishReason "length" with nothing emitted, which is a
    // turn that spent its whole budget rather than a backend that answered with nothing.
    expect(turn({ finishReason: "length" })).toEqual({
      valid: false,
      reason: "output-cap-without-content",
    });
  });

  it("reads the shape the corrupt bundles carried at step one", () => {
    // finishReason "other" with zero tokens either way: the stream ended before it said
    // anything, and this is the record that must never be scored as a run of the model.
    expect(turn({ finishReason: "other" })).toEqual({ valid: false, reason: "no-content" });
  });
});
