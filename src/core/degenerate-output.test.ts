import { describe, expect, it } from "vitest";
import { degenerateRepeatThreshold, repeatedTail } from "./degenerate-output.ts";

/**
 * Taken from a live run: gemma4:31b behind Ollama answered `<channel|>` 800 times in a row,
 * ran to the 8192-token cap over six minutes, and the loop read the result as a completion.
 * Two of five samples of the same request did the same, so the run had to see it coming.
 */
describe("what a stream repeating itself looks like", () => {
  it("names the unit and the count once a short unit has repeated past the threshold", () => {
    const text = `Plan: write the page.\n${"<channel|>".repeat(degenerateRepeatThreshold)}`;
    expect(repeatedTail(text)).toEqual({ unit: "<channel|>", repeats: degenerateRepeatThreshold });
  });

  it("says nothing below the threshold, since a run of a marker can be a model catching itself", () => {
    expect(repeatedTail("<channel|>".repeat(degenerateRepeatThreshold - 1))).toBeNull();
  });

  it("ignores a single repeated character, which is a rule or a banner rather than a spiral", () => {
    expect(repeatedTail("=".repeat(400))).toBeNull();
    expect(repeatedTail(`${"-".repeat(200)}\n`)).toBeNull();
  });

  it("reports the smallest unit that repeats, not a multiple of it", () => {
    expect(repeatedTail("ab".repeat(2 * degenerateRepeatThreshold))).toEqual({
      unit: "ab",
      repeats: 2 * degenerateRepeatThreshold,
    });
  });

  it("looks only at the tail, so a spiral that stopped is not counted against text that went on", () => {
    const text = `${"<channel|>".repeat(degenerateRepeatThreshold)} and then I wrote the file.`;
    expect(repeatedTail(text)).toBeNull();
  });

  it("finds nothing in ordinary prose or code", () => {
    expect(repeatedTail("I will read the failing test, then fix the parser.")).toBeNull();
    expect(repeatedTail("const rows = items.map((item) => item.id);\n".repeat(40))).toBeNull();
  });
});
