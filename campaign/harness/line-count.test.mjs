import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { countLines, countsAs, nonBlankLines } from "./line-count.mjs";

const scratch = [];
afterEach(async () => {
  for (const directory of scratch.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function tree(files) {
  const root = await mkdtemp(join(tmpdir(), "line-count-"));
  scratch.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

describe("which files count", () => {
  it("counts a file by the language's own extensions", () => {
    expect(countsAs("TypeScript", "src/a.ts")).toBe(true);
    expect(countsAs("TypeScript", "src/a.tsx")).toBe(true);
    expect(countsAs("TypeScript", "src/a.js")).toBe(false);
    expect(countsAs("Python", "pkg/mod.py")).toBe(true);
  });

  it("never counts a generated or declaration file", () => {
    expect(countsAs("JavaScript", "dist/bundle.min.js")).toBe(false);
    expect(countsAs("TypeScript", "types/index.d.ts")).toBe(false);
    expect(countsAs("Go", "api/thing.pb.go")).toBe(false);
    expect(countsAs("Python", "proto/thing_pb2.py")).toBe(false);
  });

  it("refuses a language nothing is sealed for", () => {
    expect(() => countsAs("Haskell", "a.hs")).toThrow("no extensions are sealed for Haskell");
  });
});

describe("counting lines", () => {
  it("counts non-blank lines only", () => {
    expect(nonBlankLines("a\n\n  \nb\n")).toBe(2);
    expect(nonBlankLines("")).toBe(0);
  });

  it("walks the tree, skipping the excluded directories", async () => {
    const root = await tree({
      "src/a.go": "package a\n\nfunc A() {}\n",
      "cmd/main.go": "package main\n",
      "vendor/dep/x.go": "package dep\nfunc X() {}\n",
      "node_modules/y/z.go": "package z\n",
      "docs/readme.md": "not go\n",
      "gen/thing.pb.go": "package gen\n",
    });

    expect(await countLines(root, "Go")).toEqual({ lines: 3, files: 2 });
  });
});
