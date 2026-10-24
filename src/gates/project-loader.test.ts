import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { exportsProgram, groundLoader, loaderCandidates } from "./project-loader.ts";

const run = promisify(execFile);

it("tries the entry the task names first, through the TypeScript loader the project installed", () => {
  const present = new Set(["./src/index.ts", "./dist/index.mjs"]);
  const candidates = loaderCandidates({
    task: "ufo (TypeScript under src/, every module re-exported from src/index.ts) ...",
    manifest: { exports: { ".": { import: "./dist/index.mjs", types: "./dist/index.d.ts" } } },
    exists: (path) => present.has(path),
    installed: (name) => (name === "jiti" ? "2.4.2" : null),
  });
  expect(candidates).toEqual([
    { entry: "./src/index.ts", method: "jiti" },
    { entry: "./src/index.ts", method: "native" },
    { entry: "./dist/index.mjs", method: "native" },
    { entry: "./dist/index.mjs", method: "jiti" },
  ]);
});

it("keeps the first candidate that loads and names exports, with every attempt", async () => {
  const outcomes = [
    { failed: "Cannot find module './src/encoding'" },
    { answer: [] },
    { answer: ["withQuery", "getQuery"] },
  ];
  let next = 0;
  const grounded = await groundLoader(
    [
      { entry: "./src/index.ts", method: "native" },
      { entry: "./src/index.ts", method: "tsx" },
      { entry: "./src/index.ts", method: "jiti" },
    ],
    async () => outcomes[next++] as { answer: unknown } | { failed: string },
  );
  expect(grounded.loader).toMatchObject({
    entry: "./src/index.ts",
    method: "jiti",
    exports: ["getQuery", "withQuery"],
  });
  expect(grounded.attempts.map((one) => one.outcome)).toEqual([
    "Cannot find module './src/encoding'",
    "it loaded and exposed no exports",
    "loaded, 2 exports",
  ]);
  const none = await groundLoader([{ entry: "./a.js", method: "native" }], async () => ({
    failed: "boom",
  }));
  expect(none.loader).toBeNull();
});

it("writes a program that loads a real module and answers its exports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "swarm-loader-"));
  try {
    await writeFile(join(directory, "index.mjs"), "export const a = 1;\nexport function b() {}\n");
    await writeFile(
      join(directory, "probe.mjs"),
      exportsProgram({ entry: "./index.mjs", method: "native" }),
    );
    const ran = await run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'const m = await import("./probe.mjs"); console.log(JSON.stringify(await m.default()));',
      ],
      { cwd: directory },
    );
    expect(JSON.parse(ran.stdout)).toEqual(["a", "b"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
