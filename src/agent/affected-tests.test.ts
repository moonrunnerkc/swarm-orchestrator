import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { affectedTests, importGraph } from "./affected-tests.ts";

async function repository(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "affected-"));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "-A"], { cwd: root });
  return root;
}

const pythonTest = (path: string) => /(^|\/)test_[^/]*\.py$/.test(path);
const scriptTest = (path: string) => /\.test\.[cm]?[jt]s$/.test(path);

describe("the tests a change reaches", () => {
  // tracemantle's layout: a package under src/, tests importing it by its dotted name.
  it("follows Python imports through a src layout, relative imports and conftest", async () => {
    const root = await repository({
      "src/tracemantle/__init__.py": "",
      "src/tracemantle/core/__init__.py": "",
      "src/tracemantle/core/history.py": "from .history_io import load\n",
      "src/tracemantle/core/history_io.py": "def load(): return 1\n",
      "src/tracemantle/report.py": "from tracemantle.core import history\n",
      "tests/conftest.py": "import pytest\n",
      "tests/test_history.py": "from tracemantle.core.history import load\n",
      "tests/test_report.py": "import tracemantle.report as report\n",
      "tests/test_alone.py": "def test_x(): pass\n",
    });
    const graph = await importGraph(root);
    const changed = (path: string) => affectedTests(graph, [path], pythonTest);
    expect(changed("src/tracemantle/core/history_io.py")).toEqual([
      "tests/test_history.py",
      "tests/test_report.py",
    ]);
    expect(changed("src/tracemantle/report.py")).toEqual(["tests/test_report.py"]);
    expect(changed("tests/conftest.py")).toEqual([
      "tests/test_alone.py",
      "tests/test_history.py",
      "tests/test_report.py",
    ]);
  });

  it("follows relative script imports written with the built extension, and new files", async () => {
    const root = await repository({
      "src/args.ts": "export const parse = () => 1;\n",
      "src/cli.ts": 'import { parse } from "./args.js";\n',
      "test/cli.test.ts": 'import { main } from "../src/cli.js";\n',
      "test/other.test.ts": 'import { x } from "vitest";\n',
    });
    await writeFile(join(root, "test/args.test.ts"), 'import { parse } from "../src/args";\n');
    const graph = await importGraph(root);
    expect(affectedTests(graph, ["src/args.ts"], scriptTest)).toEqual([
      "test/args.test.ts",
      "test/cli.test.ts",
    ]);
    // A changed test file is its own reach.
    expect(affectedTests(graph, ["test/other.test.ts"], scriptTest)).toEqual([
      "test/other.test.ts",
    ]);
  });

  // t6's move: the old module is deleted, and a test that still imports it must run.
  it("reaches the tests that still import a file the change deleted", async () => {
    const root = await repository({
      "src/pkg/__init__.py": "",
      "tests/test_old.py": "from pkg.old import load\n",
      "test/a.test.ts": 'import { a } from "../src/a.js";\n',
    });
    const graph = await importGraph(root, ["src/pkg/old.py", "src/a.ts"]);
    expect(affectedTests(graph, ["src/pkg/old.py"], pythonTest)).toEqual(["tests/test_old.py"]);
    expect(affectedTests(graph, ["src/a.ts"], scriptTest)).toEqual(["test/a.test.ts"]);
  });
});
