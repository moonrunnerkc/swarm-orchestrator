import { describe, expect, it } from "vitest";
import { editDistance, nearestName } from "./edit-distance.ts";

describe("suggesting what a word was probably meant to be", () => {
  it("suggests a near miss between words long enough for the miss to mean something", () => {
    expect(nearestName("tets", ["tests", "lint", "typecheck"])).toBe("tests");
    expect(nearestName("revie", ["review", "replay"])).toBe("review");
  });

  /**
   * Two edits between a one-letter word and a two-letter command is the whole of both words.
   * Adding a two-letter command made every one-letter task read as a typo for it: `swarm t`
   * stopped being a task and started being "did you mean swarm gc?".
   */
  it("suggests nothing for a word too short for a miss to be a miss", () => {
    expect(nearestName("t", ["gc", "gates", "review"])).toBeNull();
    expect(nearestName("x", ["gc"])).toBeNull();
  });

  it("still suggests an exact-length neighbour of a short command", () => {
    expect(nearestName("gd", ["gc", "gates"])).toBe("gc");
  });

  it("suggests nothing for a word that resembles nothing", () => {
    expect(nearestName("elephant", ["gc", "gates", "review"])).toBeNull();
  });

  it("never suggests the word itself", () => {
    expect(nearestName("gates", ["gates", "gc"])).toBeNull();
  });

  it("measures edits the way a reader would count them", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("same", "same")).toBe(0);
  });
});
