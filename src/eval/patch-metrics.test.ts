import { describe, expect, it } from "vitest";
import { metricsDelta, patchMetrics } from "./patch-metrics.ts";

const patch = [
  "diff --git a/lib/clamp.js b/lib/clamp.js",
  "--- a/lib/clamp.js",
  "+++ b/lib/clamp.js",
  "@@ -1,3 +1,6 @@",
  " export function clamp(value, low, high) {",
  "-  return value;",
  "+  if (value < low) {",
  "+    return low;",
  "+  }",
  "+  return Math.min(value, high);",
  " }",
  "diff --git a/test/clamp.test.js b/test/clamp.test.js",
  "--- a/test/clamp.test.js",
  "+++ b/test/clamp.test.js",
  "@@ -1,1 +1,2 @@",
  " import { clamp } from '../lib/clamp.js';",
  "+it('clamps low', () => expect(clamp(-1, 0, 5)).toBe(0));",
  "diff --git a/CHANGELOG.md b/CHANGELOG.md",
  "--- a/CHANGELOG.md",
  "+++ b/CHANGELOG.md",
  "@@ -1,1 +1,2 @@",
  " # Changes",
  "+clamp now clamps",
  "",
].join("\n");

describe("the size of a patch, counted the way reach reads it", () => {
  it("counts a closing brace as added and not as executable", () => {
    const measured = patchMetrics(patch);

    expect(measured.filesChanged).toBe(3);
    expect(measured.sourceFilesChanged).toBe(1);
    expect(measured.testFilesChanged).toBe(1);
    expect(measured.addedLines).toBe(6);
    expect(measured.deletedLines).toBe(1);
    // Three of the four source lines carry code; the bare `}` does not.
    expect(measured.executableAddedLines).toBe(3);
    expect(measured.executableDeletedLines).toBe(1);
    expect(measured.testAddedLines).toBe(1);
    expect(measured.diffBytes).toBe(Buffer.byteLength(patch));
  });

  it("measures nothing in an empty patch", () => {
    expect(patchMetrics("")).toMatchObject({ filesChanged: 0, addedLines: 0, diffBytes: 0 });
  });

  it("gives a repair's direction as a sign", () => {
    const smaller = patchMetrics(patch.split("diff --git a/test")[0] ?? "");
    const delta = metricsDelta(patchMetrics(patch), smaller);

    expect(delta.filesChanged).toBe(-2);
    expect(delta.executableAddedLines).toBe(0);
    expect(delta.testAddedLines).toBe(-1);
  });
});
