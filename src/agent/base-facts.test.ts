import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { baseFacts, importsOf, namedPaths, outlineOf, runtimeFacts } from "./base-facts.ts";

async function repository(files: Readonly<Record<string, string>>): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "facts-"));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await writeFile(join(repo, path), text);
  }
  return repo;
}

const filler = Array.from({ length: 200 }, (_, at) => `  const line${at} = ${at};`).join("\n");

describe("the files a task names by path", () => {
  it("are matched by their tail, and left out where the tail names two files", () => {
    const task = "Move core/io.py into a/store/";
    expect(namedPaths(["src/a/core/io.py"], task)).toEqual(["src/a/core/io.py"]);
    expect(namedPaths(["src/a/core/io.py", "src/b/core/io.py"], task)).toEqual([]);
  });
});

describe("a file's outline", () => {
  // claimcheck's src/adapters/worktree-toolchain.ts, cut down (2026-11-05, rc.10).
  it("holds its imports and whole signatures, and no bodies", () => {
    const text = [
      'import { exec } from "../util/exec.js";',
      "",
      "function strykerVersionFor(vitestMajor: number | null): string {",
      '  return vitestMajor !== null && vitestMajor < 2 ? "8.7.1" : "9.6.1";',
      "}",
      "",
      "export async function prepareToolchain(",
      "  worktreeDir: string,",
      "  toolchainModules: string,",
      "): Promise<ToolchainPrep> {",
      "  await exec(worktreeDir, []);",
      "}",
    ].join("\n");
    expect(outlineOf(text)).toEqual([
      'import { exec } from "../util/exec.js";',
      "function strykerVersionFor(vitestMajor: number | null): string {",
      "export async function prepareToolchain(",
      "  worktreeDir: string,",
      "  toolchainModules: string,",
      "): Promise<ToolchainPrep> {",
    ]);
  });

  // fix-tracemantle-f69ad0c58 (2026-11-07): tests built a ParsedSkill with fields it lacks.
  it("keeps a Python class's fields and method signatures", () => {
    const text = [
      "@dataclass(frozen=True)",
      "class ParsedSkill:",
      "    path: Path",
      "    body: str",
      "",
      "    def lines(self) -> int:",
      "        return 0",
      "",
      "def parse(path: Path) -> ParsedSkill:",
      "    return ParsedSkill(path=path, body='')",
    ].join("\n");
    expect(outlineOf(text)).toEqual([
      "@dataclass(frozen=True)",
      "class ParsedSkill:",
      "    path: Path",
      "    body: str",
      "    def lines(self) -> int:",
      "def parse(path: Path) -> ParsedSkill:",
    ]);
  });

  it("keeps the fields of an interface and the rows of exported data", () => {
    const text = [
      "export interface Invoice {",
      "  readonly ownerId: string;",
      "}",
      "export const invoices: readonly Invoice[] = [",
      '  { ownerId: "u1" },',
      "];",
      "export function total(): number {",
      "  return 0;",
      "}",
    ].join("\n");
    expect(outlineOf(text)).toEqual([
      "export interface Invoice {",
      "  readonly ownerId: string;",
      "}",
      "export const invoices: readonly Invoice[] = [",
      '  { ownerId: "u1" },',
      "];",
      "export function total(): number {",
    ]);
  });
});

describe("the base's source an author is shown", () => {
  it("follows a file's imports to the shapes it uses, in JavaScript and in Python", async () => {
    const tracked = ["src/detect.ts", "src/skill.ts", "pkg/a.py", "pkg/parser.py"];
    expect(importsOf("src/detect.ts", 'import type { Skill } from "./skill.js";', tracked)).toEqual(
      ["src/skill.ts"],
    );
    expect(importsOf("pkg/a.py", "from .parser import ParsedSkill\nimport re\n", tracked)).toEqual([
      "pkg/parser.py",
    ]);
  });

  // The invoice example (2026-11-26): shown only a test that imports data.ts, the author read a
  // `userId` the data does not have; data.ts was one import from the test it was shown.
  it("shows a small file whole and a large one outlined, seeds first, then their imports", async () => {
    const files = {
      "src/app.ts": `import { invoices } from "./data.ts";\nexport function handle(): void {\n${filler}\n}\n`,
      "src/data.ts": "export interface Invoice {\n  readonly ownerId: string;\n}\n",
      "src/unrelated.ts": "export const other = 1;\n",
    };
    const repo = await repository(files);
    const shown = await baseFacts(repo, Object.keys(files), ["src/app.ts"]);
    expect(shown.map((one) => [one.path, one.whole])).toEqual([
      ["src/app.ts", false],
      ["src/data.ts", true],
    ]);
    expect(shown[0]?.lines).toEqual([
      'import { invoices } from "./data.ts";',
      "export function handle(): void {",
    ]);
    expect(shown[1]?.lines.join("\n")).toContain("readonly ownerId: string;");
  });

  it("stops at its budget, and never reads a file twice", async () => {
    const big = `export const rows = [\n${filler}\n];\n`.repeat(8);
    const files: Record<string, string> = { "src/a.ts": 'import "./a.ts";\nexport const a = 1;\n' };
    for (let at = 0; at < 14; at += 1) files[`src/big${at}.ts`] = `// ${at}\n${big}`;
    const repo = await repository(files);
    const shown = await baseFacts(repo, Object.keys(files), Object.keys(files));
    expect(shown.length).toBeLessThanOrEqual(10);
    expect(shown.map((one) => one.lines.join("\n")).join("\n").length).toBeLessThanOrEqual(16_000);
    expect(shown.filter((one) => one.path === "src/a.ts")).toHaveLength(1);
  });
});

describe("how the base's code is loaded and started", () => {
  const example = { path: "test/a.test.ts", content: 'import { test } from "node:test";\n' };

  // The invoice example's repair task (2026-11-26): the draft used require in an ES module.
  it("says an ES module package takes import, that node strips the types, and how the app starts", async () => {
    const repo = await repository({
      "package.json": JSON.stringify({
        type: "module",
        scripts: { start: "node src/server.ts", test: "node --test" },
        engines: { node: ">=24" },
      }),
    });
    const facts = await runtimeFacts(repo, ["src/server.ts", "src/app.ts"], example);
    expect(facts.entries).toEqual(["src/server.ts"]);
    expect(facts.notes.join("\n")).toMatch(/ES modules.*Use import; require/);
    expect(facts.notes.join("\n")).toMatch(/removing the types/);
    expect(facts.notes.join("\n")).toContain("Node: >=24.");
    expect(facts.notes.join("\n")).toContain("starts with `node src/server.ts`");
  });

  it("says CommonJS where the package and its tests are, and nothing where there is no manifest", async () => {
    const common = await repository({ "package.json": JSON.stringify({ main: "./lib/index.js" }) });
    const facts = await runtimeFacts(common, ["lib/index.js"], {
      path: "test/a.test.js",
      content: 'const assert = require("node:assert");\n',
    });
    expect(facts.notes).toEqual([
      "Modules: CommonJS. Load code with require, as the example test does.",
    ]);
    expect(facts.entries).toEqual(["lib/index.js"]);
    expect(await runtimeFacts(await repository({}), [], example)).toEqual({
      notes: [],
      entries: [],
    });
  });
});
