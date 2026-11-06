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
});
