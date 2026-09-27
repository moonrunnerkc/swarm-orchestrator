import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { planGates } from "../src/config/init.ts";
import { harnessChildEnvironment } from "../src/exec/child-environment.ts";
import { createNodeCommandRunner } from "../src/gates/node-command-runner.ts";
import { detectProject } from "../src/gates/project-type.ts";
import { readRunnerResult } from "../src/gates/runner-results.ts";
import { structuredRunner } from "../src/gates/structured-runner.ts";

const parent = join(homedir(), ".swarm", "upgrade-validation");
await mkdir(parent, { recursive: true, mode: 0o700 });
const root = await mkdtemp(join(parent, "toolchains-"));
const commands = createNodeCommandRunner(
  { now: () => Date.now(), sleep: async () => {} },
  harnessChildEnvironment(),
);
const evidence = [];
async function run(argv, cwd, status = 0) {
  const observed = await commands.runVouched(argv, {
    cwd,
    timeoutMs: 240000,
    maxOutputBytes: 2000000,
  });
  evidence.push({ argv, cwd, ...observed });
  await writeFile(join(root, "observations.json"), JSON.stringify(evidence, null, 2), {
    mode: 0o600,
  });
  if (observed.exitCode !== status || observed.unavailable)
    throw Error(`toolchain action failed: ${argv.slice(0, 4)}: ${observed.stderr}`);
  return observed;
}
async function check(cwd, body) {
  const argv = structuredRunner(body);
  if (!argv) throw Error("unrecognized supported runner");
  const good = readRunnerResult(await run(argv, cwd));
  if (good.status !== "passed") throw Error(JSON.stringify(good));
  return argv;
}
try {
  const python = join(root, "python");
  await mkdir(python);
  await writeFile(join(python, ".gitignore"), ".venv/\n__pycache__/\n.pytest_cache/\n");
  await writeFile(
    join(python, "pyproject.toml"),
    '[project]\nname="swarm-python-fixture"\nversion="0.1.0"\nrequires-python=">=3.12"\ndependencies=["pytest==9.0.2"]\n[tool.pytest.ini_options]\ntestpaths=["."]\n',
  );
  await writeFile(join(python, "test_behavior.py"), "def test_value():\n    assert 1 + 1 == 2\n");
  await run(["uv", "--version"], python);
  await run(["uv", "lock"], python);
  await run(["uv", "sync", "--locked", "--no-install-project"], python);
  const read = (path) => readFile(join(python, path), "utf8").catch(() => null);
  const detection = await detectProject(read);
  evidence.push({ detection, plan: planGates(detection) });
  const uv = await check(python, "uv run --locked --no-sync python -m pytest -q");
  const pip = await check(python, ".venv/bin/python -m pytest -q");
  await writeFile(join(python, "test_behavior.py"), "def test_value():\n    assert 1 + 1 == 3\n");
  for (const argv of [uv, pip]) {
    const bad = readRunnerResult(await run(argv, python, 1));
    if (bad.status !== "failed") throw Error("wrong behavior was accepted");
  }
  const node = join(root, "pnpm");
  await mkdir(node);
  await writeFile(
    join(node, "package.json"),
    JSON.stringify({
      name: "swarm-pnpm-fixture",
      version: "1.0.0",
      type: "module",
      packageManager: "pnpm@9.15.0",
      scripts: { test: "vitest run" },
      devDependencies: { vitest: "4.1.11" },
    }),
  );
  await writeFile(
    join(node, "behavior.test.js"),
    "import {test,expect} from 'vitest';test('addition',()=>expect(1+1).toBe(2));\n",
  );
  await run(["pnpm", "--version"], node);
  await run(["pnpm", "install", "--ignore-scripts"], node);
  await run(["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"], node);
  const vitest = await check(node, "vitest run");
  await writeFile(
    join(node, "behavior.test.js"),
    "import {test,expect} from 'vitest';test('addition',()=>expect(1+1).toBe(3));\n",
  );
  if (readRunnerResult(await run(vitest, node, 1)).status !== "failed")
    throw Error("Vitest false green");
  console.log(JSON.stringify({ root, status: "passed", observations: evidence.length }));
} catch (cause) {
  console.error(`toolchain evidence: ${root}`);
  throw cause;
}
