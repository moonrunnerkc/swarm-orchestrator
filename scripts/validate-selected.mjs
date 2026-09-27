import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = mkdtempSync(join(homedir(), ".swarm/upgrade-validation/selected-"));
const repo = join(root, "project");
mkdirSync(repo, { mode: 0o700 });
const source = resolve(import.meta.dirname, "..");
const env = { PATH: process.env.PATH, HOME: join(root, "home"), NO_COLOR: "1" };
mkdirSync(env.HOME, { mode: 0o700 });
const observations = [];
function run(argv, cwd = repo, expected = 0) {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    env,
    encoding: "utf8",
    timeout: 240000,
    maxBuffer: 8000000,
  });
  observations.push({
    argv,
    cwd,
    exit: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  });
  writeFileSync(join(root, "observations.json"), JSON.stringify(observations, null, 2), {
    mode: 0o600,
  });
  if (result.status !== expected)
    throw Error(`${argv.slice(0, 4)}: ${result.status}: ${result.stderr}`);
  return result.stdout.trim();
}
const git = (args) =>
  run(["git", "-c", "user.name=fixture", "-c", "user.email=fixture@example.test", ...args]);
const full = process.argv[2] ?? join(source, "dist/cli.js"),
  verify = process.argv[3] ?? join(source, "packages/swarm-verify/dist/swarm-verify.js");
try {
  const node = join(repo, "packages/web"),
    python = join(repo, "services/api");
  mkdirSync(node, { recursive: true });
  mkdirSync(python, { recursive: true });
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({
      name: "mixed-fixture",
      private: true,
      version: "1.0.0",
      packageManager: "pnpm@9.15.0",
      devDependencies: { vitest: "4.1.11" },
    }),
  );
  writeFileSync(join(repo, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n.venv/\n__pycache__/\n.pytest_cache/\n");
  writeFileSync(
    join(node, "package.json"),
    JSON.stringify({
      name: "web",
      version: "1.0.0",
      type: "module",
      scripts: { test: "vitest run" },
    }),
  );
  writeFileSync(join(node, "value.js"), "export const value = () => 1;\n");
  writeFileSync(
    join(node, "value.test.js"),
    "import{test,expect}from'vitest';import{value}from'./value.js';test('value',()=>expect(value()).toBe(1));\n",
  );
  writeFileSync(
    join(python, "pyproject.toml"),
    '[project]\nname="api-fixture"\nversion="0.1.0"\nrequires-python=">=3.12"\ndependencies=["pytest==9.0.2"]\n[tool.pytest.ini_options]\ntestpaths=["."]\n',
  );
  writeFileSync(join(python, "value.py"), "def value():\n    return 1\n");
  writeFileSync(
    join(python, "test_value.py"),
    "from value import value\ndef test_value():\n    assert value() == 1\n",
  );
  run(["pnpm", "install", "--ignore-scripts"]);
  run(["uv", "lock"], python);
  run(["uv", "sync", "--locked", "--no-install-project"], python);
  const selection = ["--package", "packages/web", "--package", "services/api"];
  run([process.execPath, full, "init", "--workspace", repo, ...selection]);
  const config = readFileSync(join(repo, "swarm.toml"), "utf8");
  if (!config.includes("structured-test-output"))
    throw Error("init omitted structured runner policy");
  run([process.execPath, full, "init", "--workspace", repo, ...selection], repo, 1);
  if (readFileSync(join(repo, "swarm.toml"), "utf8") !== config)
    throw Error("repeated init changed configuration");
  git(["init", "-q"]);
  git(["add", "--all"]);
  git(["commit", "-qm", "base behavior"]);
  const base = git(["rev-parse", "HEAD"]);
  writeFileSync(join(node, "value.js"), "export function value() { return 1; }\n");
  writeFileSync(join(python, "value.py"), "def value():\n    result = 1\n    return result\n");
  git(["commit", "-qam", "refactor control"]);
  const head = git(["rev-parse", "HEAD"]);
  const contract = join(root, "refactor.json");
  const checks = [
    {
      id: "web",
      cwd: "packages/web",
      argv: [
        "node",
        "--input-type=module",
        "-e",
        "import{value}from'./value.js';console.log(value())",
      ],
    },
    {
      id: "api",
      cwd: "services/api",
      argv: [
        "uv",
        "run",
        "--locked",
        "--no-sync",
        "python",
        "-c",
        "from value import value;print(value())",
      ],
    },
  ].map(({ id, cwd, argv }) => ({
    id,
    command: "generated characterization instrument",
    author: "model",
    exposure: "withheld",
    artifacts: [],
    behavior: {
      kind: "cli",
      cwd,
      argv,
      toolchain: id === "web" ? "Node 24" : "Python 3.14",
      network: "inherit",
      timeoutMs: 10000,
      maxOutputBytes: 4000,
      exitCode: 0,
      stdout: [{ kind: "equals", value: "1\n" }],
      stderr: [],
    },
  }));
  writeFileSync(
    contract,
    JSON.stringify({
      version: 1,
      goal: "Preserve selected behavior",
      preset: { kind: "refactor" },
      requirements: checks.map(({ id }) => ({
        id,
        description: "Preserve returned value",
        checks: [id],
      })),
      checks,
      immutablePaths: ["packages/web/value.test.js", "services/api/test_value.py"],
    }),
  );
  const args = [
    process.execPath,
    verify,
    "ci",
    "--workspace",
    repo,
    "--base",
    base,
    "--branch",
    head,
    ...selection,
    "--goal-contract",
    contract,
    "--install",
    "--json",
  ];
  const report = JSON.parse(run(args));
  if (
    !report.verified ||
    !report.checks.some(
      (check) => check.id === "tests:services/api" && check.status === "passed",
    ) ||
    !report.checks.some((check) => check.id === "tests:packages/web" && check.status === "passed")
  )
    throw Error("mixed selected checks did not pass");
  writeFileSync(join(node, "value.js"), "export function value() { return 2; }\n");
  git(["commit", "-qam", "wrong behavior"]);
  const bad = JSON.parse(
    run(
      args.map((arg) => (arg === head ? "HEAD" : arg)),
      repo,
      1,
    ),
  );
  if (bad.task !== "rejected") throw Error("refactor accepted changed output");
  writeFileSync(join(repo, "shared.txt"), "outside selected scope\n");
  git(["add", "shared.txt"]);
  git(["commit", "-qm", "outside scope"]);
  run(
    args.map((arg) => (arg === head ? "HEAD" : arg)),
    repo,
    1,
  );
  if (!observations.at(-1).stderr.includes("outside selected packages"))
    throw Error("out-of-scope control failed for the wrong reason");

  const pip = join(root, "pip");
  mkdirSync(pip, { mode: 0o700 });
  for (const file of ["pyproject.toml", "value.py", "test_value.py"])
    cpSync(join(python, file), join(pip, file));
  cpSync(join(python, ".venv"), join(pip, ".venv"), { recursive: true, verbatimSymlinks: true });
  writeFileSync(join(pip, ".gitignore"), ".venv/\n__pycache__/\n.pytest_cache/\n");
  run([process.execPath, full, "init", "--workspace", pip], pip);
  const pipGit = (args) =>
    run(["git", "-c", "user.name=fixture", "-c", "user.email=fixture@example.test", ...args], pip);
  pipGit(["init", "-q"]);
  pipGit(["add", "--all"]);
  pipGit(["commit", "-qm", "existing environment base"]);
  const pipBase = pipGit(["rev-parse", "HEAD"]);
  writeFileSync(join(pip, "value.py"), "def value():\n    return int(1)\n");
  pipGit(["commit", "-qam", "existing environment refactor"]);
  const pipContract = join(root, "pip-contract.json");
  const definition = JSON.parse(readFileSync(contract, "utf8"));
  definition.requirements = [definition.requirements[1]];
  definition.checks = [definition.checks[1]];
  definition.checks[0].behavior.cwd = ".";
  definition.checks[0].behavior.argv = [
    ".venv/bin/python",
    "-c",
    "from value import value;print(value())",
  ];
  definition.immutablePaths = ["test_value.py"];
  writeFileSync(pipContract, JSON.stringify(definition));
  const environmentBefore = readFileSync(join(pip, ".venv/pyvenv.cfg"), "utf8");
  const pipReport = JSON.parse(
    run(
      [
        process.execPath,
        verify,
        "ci",
        "--workspace",
        pip,
        "--base",
        pipBase,
        "--branch",
        "HEAD",
        "--goal-contract",
        pipContract,
        "--json",
      ],
      pip,
    ),
  );
  if (
    !pipReport.verified ||
    pipReport.install !== null ||
    readFileSync(join(pip, ".venv/pyvenv.cfg"), "utf8") !== environmentBefore
  )
    throw Error("existing venv verification changed the original environment or failed");
  console.log(JSON.stringify({ root, status: "passed", observations: observations.length }));
} catch (cause) {
  console.error(`selected evidence: ${root}`);
  throw cause;
}
