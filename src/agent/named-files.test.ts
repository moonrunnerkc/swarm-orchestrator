import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { namedFiles } from "./named-files.ts";

// claimcheck's src/adapters/worktree-toolchain.ts, cut down.
const toolchain = [
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
  "",
].join("\n");

describe("a file the task names by path", () => {
  it("is shown with its imports and whole signatures, and no bodies", async () => {
    const repo = await mkdtemp(join(tmpdir(), "named-"));
    await mkdir(join(repo, "src", "adapters"), { recursive: true });
    await writeFile(join(repo, "src", "adapters", "worktree-toolchain.ts"), toolchain);
    const files = await namedFiles(
      repo,
      ["src/adapters/worktree-toolchain.ts", "src/cli.ts"],
      "move the Stryker version it installs (src/adapters/worktree-toolchain.ts) to 10.x",
    );
    expect(files).toEqual([
      {
        path: "src/adapters/worktree-toolchain.ts",
        outline: [
          'import { exec } from "../util/exec.js";',
          "function strykerVersionFor(vitestMajor: number | null): string {",
          "export async function prepareToolchain(",
          "  worktreeDir: string,",
          "  toolchainModules: string,",
          "): Promise<ToolchainPrep> {",
        ],
      },
    ]);
  });

  it("is matched by its tail, and left out where the tail names two files", async () => {
    const repo = await mkdtemp(join(tmpdir(), "named-"));
    await mkdir(join(repo, "src", "a", "core"), { recursive: true });
    await writeFile(join(repo, "src", "a", "core", "io.py"), "def load():\n    pass\n");
    const one = await namedFiles(repo, ["src/a/core/io.py"], "Move core/io.py into a/store/");
    expect(one.map((file) => file.outline)).toEqual([["def load():"]]);
    const two = await namedFiles(
      repo,
      ["src/a/core/io.py", "src/b/core/io.py"],
      "Move core/io.py into a/store/",
    );
    expect(two).toEqual([]);
  });
  // fix-tracemantle-f69ad0c58 (Arm C, 2026-11-07): the author saw is_template(skill: ParsedSkill)
  // and nothing of ParsedSkill, which parser.py defines; both of its tests built one with fields
  // it does not have, and every case failed at the base on the constructor.
  it("is followed by the repository types its signatures take, with their fields", async () => {
    const repo = await mkdtemp(join(tmpdir(), "named-"));
    await mkdir(join(repo, "src", "skillcheck"), { recursive: true });
    await writeFile(
      join(repo, "src", "skillcheck", "template_detection.py"),
      "import re\n\nfrom .parser import ParsedSkill\n\n\ndef is_template(skill: ParsedSkill) -> bool:\n    return False\n",
    );
    await writeFile(
      join(repo, "src", "skillcheck", "parser.py"),
      [
        "from dataclasses import dataclass",
        "",
        "",
        "@dataclass(frozen=True)",
        "class ParsedSkill:",
        "    path: Path",
        "    body: str",
        "",
        "    def lines(self) -> int:",
        "        return 0",
        "",
        "",
        "def parse(path: Path) -> ParsedSkill:",
        "    return ParsedSkill(path=path, body='')",
        "",
      ].join("\n"),
    );
    const files = await namedFiles(
      repo,
      ["src/skillcheck/template_detection.py", "src/skillcheck/parser.py"],
      "is_template in src/skillcheck/template_detection.py reads [ISO] as a template.",
    );
    expect(files).toEqual([
      {
        path: "src/skillcheck/template_detection.py",
        outline: [
          "import re",
          "from .parser import ParsedSkill",
          "def is_template(skill: ParsedSkill) -> bool:",
        ],
      },
      {
        path: "src/skillcheck/parser.py",
        outline: [
          "@dataclass(frozen=True)",
          "class ParsedSkill:",
          "    path: Path",
          "    body: str",
          "    def lines(self) -> int:",
        ],
      },
    ]);
  });

  it("follows a TypeScript type its signatures import, and not one they leave unused", async () => {
    const repo = await mkdtemp(join(tmpdir(), "named-"));
    await mkdir(join(repo, "src"), { recursive: true });
    await writeFile(
      join(repo, "src", "detect.ts"),
      'import type { Skill } from "./skill.js";\nimport { other } from "./other.js";\n\nexport function isTemplate(skill: Skill): boolean {\n  return other(skill);\n}\n',
    );
    await writeFile(
      join(repo, "src", "skill.ts"),
      "export interface Skill {\n  readonly name: string;\n  readonly body: string;\n}\n\nexport const empty = 0;\n",
    );
    await writeFile(
      join(repo, "src", "other.ts"),
      "export function other(): boolean {\n  return false;\n}\n",
    );
    const files = await namedFiles(
      repo,
      ["src/detect.ts", "src/skill.ts", "src/other.ts"],
      "isTemplate in src/detect.ts misreads [ISO].",
    );
    expect(files.map((file) => file.path)).toEqual(["src/detect.ts", "src/skill.ts"]);
    expect(files[1]?.outline).toEqual([
      "export interface Skill {",
      "  readonly name: string;",
      "  readonly body: string;",
      "}",
    ]);
  });
});
