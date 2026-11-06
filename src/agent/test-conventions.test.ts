import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { runnerOf, taskIdentifiers, testConventions } from "./test-conventions.ts";

async function repository(files: Readonly<Record<string, string>>): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "conventions-"));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await writeFile(join(repo, path), text);
  }
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });
  git("init", "-q");
  git("add", "-A");
  return repo;
}

// pubprep's --reviewers task (2026-11-04): the first live author imported ../src/index.js,
// which pubprep does not have, because it was shown a test that imports nothing the task names.
const reviewers =
  "parseArgs returns the choice as `reviewers`. orchestrate takes the same list; main passes it.";

describe("a repository's test conventions", () => {
  it("models the authored check on the test that imports what the task names, and says where those are defined", async () => {
    const repo = await repository({
      "package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
      "src/cli.ts":
        "export function parseArgs(argv: string[]) {}\nexport async function main() {}\n",
      "src/orchestrate.ts": "export async function orchestrate() {}\n",
      "src/paths.ts": "export const reviewers = [];\n",
      "test/paths.test.ts": 'import { reviewers } from "../src/paths.js";\n',
      "test/cli.test.ts": 'import { parseArgs } from "../src/cli.js";\nparseArgs([]);\n',
    });
    const found = await testConventions(repo, reviewers);
    expect(found?.runner).toBe("vitest");
    expect(found?.example.path).toBe("test/cli.test.ts");
    expect(found?.pathFor("R1")).toBe("test/cli.swarm-r1.test.ts");
    expect(found?.commandFor("test/cli.swarm-r1.test.ts")).toBe(
      "npx vitest run test/cli.swarm-r1.test.ts",
    );
    expect(found?.definitions.map((one) => `${one.name} ${one.path}:${one.line}`)).toEqual([
      "parseArgs src/cli.ts:1",
      "reviewers src/paths.ts:1",
      "main src/cli.ts:2",
      "orchestrate src/orchestrate.ts:1",
    ]);
  });

  it("runs a pytest file without the project's coverage threshold, from the worktree's interpreter", async () => {
    const repo = await repository({
      "pyproject.toml": '[tool.pytest.ini_options]\naddopts = "--cov=pkg --cov-fail-under=30"\n',
      "src/pkg/core.py": "def _falsify():\n    pass\n",
      "tests/test_core.py": "from pkg.core import _falsify\n",
    });
    const found = await testConventions(repo, "move _falsify out of core.py");
    expect(found?.pathFor("R1")).toBe("tests/test_swarm_r1_core.py");
    expect(found?.commandFor("tests/test_swarm_r1_core.py")).toBe(
      "PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -q -p no:cacheprovider --no-cov tests/test_swarm_r1_core.py",
    );
  });

  it("reads the runner from the declared checks before the manifest", async () => {
    expect(runnerOf("node --test")).toBe("node");
    expect(runnerOf("npx vitest run")).toBe("vitest");
    expect(runnerOf("python3 -m pytest -q")).toBe("pytest");
    expect(runnerOf("npm run build")).toBeNull();
  });

  it("takes code names from the wording and leaves flags and values", () => {
    expect(
      taskIdentifiers("Add --reviewers (tech-debt, docs) to `parseArgs`; keep _BUILTIN_CLAIMS"),
    ).toEqual(["parseArgs", "_BUILTIN_CLAIMS"]);
  });
});
