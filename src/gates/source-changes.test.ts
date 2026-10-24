import { expect, it } from "vitest";
import { changesOfPrinted, hunksByFile, movedLine } from "./source-changes.ts";

const zeroContext = [
  "diff --git a/src/a.js b/src/a.js",
  "index 1111111..2222222 100644",
  "--- a/src/a.js",
  "+++ b/src/a.js",
  "@@ -2 +2 @@",
  "-var legacy = 1;",
  "+let legacy = 1;",
  "@@ -3,0 +4,3 @@",
  "+one",
  "+two",
  "+three",
  "@@ -8,2 +10,0 @@",
  "-gone",
  "-also gone",
  "diff --git a/new.js b/new.js",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/new.js",
  "@@ -0,0 +1,2 @@",
  "+a",
  "+b",
  "",
].join("\n");

it("reads git's zero-context hunks as they are", () => {
  const files = hunksByFile(zeroContext);
  expect(files.get("src/a.js")).toEqual([
    [2, 1, 2, 1],
    [3, 0, 4, 3],
    [8, 2, 10, 0],
  ]);
  expect(files.get("new.js")).toEqual([[0, 0, 1, 2]]);
});

it("reduces a diff with context to the same hunks", () => {
  const withContext = [
    "diff --git a/src/a.js b/src/a.js",
    "--- a/src/a.js",
    "+++ b/src/a.js",
    "@@ -1,10 +1,11 @@",
    " // head",
    "-var legacy = 1;",
    "+let legacy = 1;",
    " export { legacy };",
    "+one",
    "+two",
    "+three",
    " four",
    " five",
    " six",
    " seven",
    "-gone",
    "-also gone",
    " ten",
    "",
  ].join("\n");
  expect(hunksByFile(withContext).get("src/a.js")).toEqual(
    hunksByFile(zeroContext).get("src/a.js"),
  );
});

it("moves an untouched line by what came before it, and gives a touched line no counterpart", () => {
  const hunks = hunksByFile(zeroContext).get("src/a.js") ?? "unmappable";
  expect(movedLine(hunks, 1)).toBe(1);
  expect(movedLine(hunks, 2)).toBeNull();
  expect(movedLine(hunks, 3)).toBe(3);
  expect(movedLine(hunks, 4)).toBe(7);
  expect(movedLine(hunks, 8)).toBeNull();
  expect(movedLine(hunks, 9)).toBeNull();
  expect(movedLine(hunks, 10)).toBe(11);
  expect(movedLine([], 5)).toBe(5);
  expect(movedLine("unmappable", 5)).toBeNull();
});

it("keys changes by the path a tool printed, and cannot follow a renamed or outside file", () => {
  const renamed = [
    "diff --git a/old.js b/moved.js",
    "similarity index 90%",
    "rename from old.js",
    "rename to moved.js",
    "",
  ].join("\n");
  expect(
    changesOfPrinted(
      ["/work/p/src/a.js", "src/b.js", "/elsewhere/c.js", "moved.js"],
      `${zeroContext}${renamed}`,
      "/work/p",
    ),
  ).toEqual({
    "/elsewhere/c.js": "unmappable",
    "/work/p/src/a.js": [
      [2, 1, 2, 1],
      [3, 0, 4, 3],
      [8, 2, 10, 0],
    ],
    "moved.js": "unmappable",
    "src/b.js": [],
  });
});
