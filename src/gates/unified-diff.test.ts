import { describe, expect, it } from "vitest";
import { parseUnifiedDiff, reconstructSides } from "./unified-diff.ts";

const patch = [
  "diff --git a/src/math.ts b/src/math.ts",
  "--- a/src/math.ts",
  "+++ b/src/math.ts",
  "@@ -1,3 +1,4 @@",
  " export function add(a: number, b: number) {",
  "-  return a - b;",
  "+  // fixed",
  "+  return a + b;",
  " }",
].join("\n");

describe("parsing a unified diff", () => {
  it("numbers added lines against the file as it stands after the change", () => {
    const [file] = parseUnifiedDiff(patch);

    expect(file?.path).toBe("src/math.ts");
    expect(file?.kind).toBe("modified");
    expect(file?.addedLines).toEqual([
      { line: 2, text: "  // fixed" },
      { line: 3, text: "  return a + b;" },
    ]);
    expect(file?.removedLines).toEqual(["  return a - b;"]);
  });

  it("recognizes an added file and a deleted one", () => {
    const added = parseUnifiedDiff(
      [
        "diff --git a/new.ts b/new.ts",
        "--- /dev/null",
        "+++ b/new.ts",
        "@@ -0,0 +1,2 @@",
        "+export const one = 1;",
        "+export const two = 2;",
      ].join("\n"),
    );
    expect(added[0]).toMatchObject({ path: "new.ts", kind: "added" });
    expect(added[0]?.addedLines.map((line) => line.line)).toEqual([1, 2]);

    const deleted = parseUnifiedDiff(
      [
        "diff --git a/gone.ts b/gone.ts",
        "--- a/gone.ts",
        "+++ /dev/null",
        "@@ -1,1 +0,0 @@",
        "-export const one = 1;",
      ].join("\n"),
    );
    expect(deleted[0]).toMatchObject({ path: "gone.ts", kind: "deleted" });
  });

  it("keeps hunks in the same file together and separate files apart", () => {
    const files = parseUnifiedDiff(
      [
        "diff --git a/a.ts b/a.ts",
        "--- a/a.ts",
        "+++ b/a.ts",
        "@@ -1,0 +1,1 @@",
        "+const a = 1;",
        "@@ -10,0 +12,1 @@",
        "+const b = 2;",
        "diff --git a/b.ts b/b.ts",
        "--- a/b.ts",
        "+++ b/b.ts",
        "@@ -1,0 +1,1 @@",
        "+const c = 3;",
      ].join("\n"),
    );

    expect(files.map((file) => file.path)).toEqual(["a.ts", "b.ts"]);
    expect(files[0]?.addedLines.map((line) => line.line)).toEqual([1, 12]);
  });

  it("ignores the no-newline marker, which moves no line", () => {
    const [file] = parseUnifiedDiff(
      [
        "diff --git a/a.ts b/a.ts",
        "--- a/a.ts",
        "+++ b/a.ts",
        "@@ -1 +1 @@",
        "-old",
        "\\ No newline at end of file",
        "+new",
        "\\ No newline at end of file",
      ].join("\n"),
    );

    expect(file?.addedLines).toEqual([{ line: 1, text: "new" }]);
  });
});

describe("reconstructing both sides of a stored patch", () => {
  it("builds the base from context plus removals and the head from context plus additions", () => {
    const sides = reconstructSides(patch);

    expect(sides.get("src/math.ts")?.base).toBe(
      ["export function add(a: number, b: number) {", "  return a - b;", "}"].join("\n"),
    );
    expect(sides.get("src/math.ts")?.head).toBe(
      ["export function add(a: number, b: number) {", "  // fixed", "  return a + b;", "}"].join(
        "\n",
      ),
    );
  });
});
