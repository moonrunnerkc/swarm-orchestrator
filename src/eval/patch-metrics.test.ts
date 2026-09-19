import { describe, expect, it } from "vitest";
import { addedLineText, metricsDelta, patchFiles, patchMetrics } from "./patch-metrics.ts";

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

describe("the files of a patch, compared one by one", () => {
  const section = (path: string, index: string, lines: readonly string[]) =>
    [
      `diff --git a/${path} b/${path}`,
      "new file mode 100644",
      `index 0000000..${index}`,
      "--- /dev/null",
      `+++ b/${path}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
      "",
    ].join("\n");

  it("gives an unchanged file the same digest whatever git abbreviated its blob to", () => {
    const before = patchFiles(section("lib/a.js", "1a2b3c4", ["const a = 1;"]));
    const after = patchFiles(
      section("lib/a.js", "1a2b3c4d5e", ["const a = 1;"]) +
        section("probe-tmp.js", "9f8e7d6", ["console.log(1);"]),
    );
    expect(after.map((file) => file.path)).toEqual(["lib/a.js", "probe-tmp.js"]);
    expect(after[0]?.diffDigest).toBe(before[0]?.diffDigest);
    expect(after[1]).toMatchObject({ path: "probe-tmp.js", change: "added" });
  });

  it("gives a file whose added lines differ a different digest", () => {
    const one = patchFiles(section("lib/a.js", "1a2b3c4", ["const a = 1;"]))[0];
    const other = patchFiles(section("lib/a.js", "1a2b3c4", ["const a = 2;"]))[0];
    expect(one?.diffDigest).not.toBe(other?.diffDigest);
  });

  it("reads one added line's text by path and number, trimmed, or nothing", () => {
    const patch = section("lib/a.js", "1a2b3c4", ["function a() {", "  return 1;", "}"]);
    expect(addedLineText(patch, "lib/a.js", 2)).toBe("return 1;");
    expect(addedLineText(patch, "lib/a.js", 9)).toBeNull();
    expect(addedLineText(patch, "lib/b.js", 1)).toBeNull();
  });
});
