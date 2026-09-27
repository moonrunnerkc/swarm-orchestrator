import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = mkdtempSync(join(homedir(), ".swarm/upgrade-validation/presets-"));
const repository = resolve(import.meta.dirname, "..");
const observations = [];
const env = { PATH: process.env.PATH, HOME: join(root, "home"), NO_COLOR: "1" };
mkdirSync(env.HOME, { mode: 0o700 });
const cli = process.argv[2] ?? join(repository, "packages/swarm-verify/dist/swarm-verify.js");
function run(argv, cwd, expected = 0) {
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
    expected,
    stdout: result.stdout,
    stderr: result.stderr,
  });
  writeFileSync(join(root, "observations.json"), JSON.stringify(observations, null, 2), {
    mode: 0o600,
  });
  if (result.status !== expected)
    throw Error(`${argv.slice(0, 4)} returned ${result.status}: ${result.stderr}`);
  return result.stdout.trim();
}
const git = (args, cwd) =>
  run(
    ["git", "-c", "user.name=Swarm fixture", "-c", "user.email=fixture@example.test", ...args],
    cwd,
  );
try {
  for (const manager of ["npm", "pnpm", "uv"]) {
    const cwd = join(root, manager);
    mkdirSync(cwd, { mode: 0o700 });
    const python = manager === "uv";
    const name = python ? "idna" : "is-number",
      oldVersion = python ? "3.10" : "6.0.0",
      version = python ? "3.11" : "7.0.0";
    const manifest = python ? "pyproject.toml" : "package.json";
    const lockfile = python
      ? "uv.lock"
      : manager === "npm"
        ? "package-lock.json"
        : "pnpm-lock.yaml";
    const writeManifest = (target, tampered = false) =>
      writeFileSync(
        join(cwd, manifest),
        python
          ? `[project]\nname="preset-fixture"\nversion="0.1.0"\nrequires-python=">=3.12"\ndependencies=["pytest==9.0.2","idna==${target}"]\n[tool.pytest.ini_options]\ntestpaths=["."]\n${tampered ? "[tool.ruff]\nline-length=120\n" : ""}`
          : JSON.stringify({
              name: "preset-fixture",
              version: "1.0.0",
              packageManager: `${manager}@${manager === "npm" ? "11.12.1" : "9.15.0"}`,
              scripts: {
                test: tampered ? "true" : "node --test",
                build: "node -e \"require('is-number')\"",
              },
              dependencies: { [name]: target },
            }),
      );
    writeFileSync(join(cwd, ".gitignore"), "node_modules/\n.venv/\n__pycache__/\n.pytest_cache/\n");
    writeFileSync(
      join(cwd, python ? "test_behavior.py" : "behavior.test.cjs"),
      python
        ? "import idna\ndef test_encoding():\n    assert idna.encode('example.com') == b'example.com'\n"
        : "const{test}=require('node:test');const assert=require('node:assert/strict');test('numbers',()=>assert.equal(require('is-number')('3'),true));\n",
    );
    const lock = () =>
      run(
        python
          ? ["uv", "lock"]
          : manager === "npm"
            ? [
                "npm",
                "install",
                "--package-lock-only",
                "--ignore-scripts",
                "--no-audit",
                "--no-fund",
              ]
            : ["pnpm", "install", "--lockfile-only", "--ignore-scripts"],
        cwd,
      );
    writeManifest(oldVersion);
    lock();
    git(["init", "-q"], cwd);
    git(["add", "--all"], cwd);
    git(["commit", "-qm", "base dependency"], cwd);
    const base = git(["rev-parse", "HEAD"], cwd);
    writeManifest(version);
    lock();
    git(["commit", "-qam", "upgrade dependency"], cwd);
    const head = git(["rev-parse", "HEAD"], cwd);
    const contract = join(root, `${manager}.json`);
    writeFileSync(
      contract,
      JSON.stringify({
        version: 1,
        goal: "Upgrade a named dependency while preserving its used behavior",
        preset: {
          kind: "upgrade",
          manager,
          manifest,
          lockfile,
          dependencies: [{ name, section: "dependencies", version }],
          sourcePaths: [],
        },
        requirements: [
          {
            id: "dependency-behavior",
            description: "Preserve the used API result",
            checks: ["behavior"],
          },
        ],
        checks: [
          {
            id: "behavior",
            command: "generated dependency behavior instrument",
            author: "model",
            exposure: "withheld",
            artifacts: [],
            behavior: {
              kind: "cli",
              cwd: ".",
              timeoutMs: 10000,
              maxOutputBytes: 8000,
              toolchain: python ? "Python 3.14" : "Node 24",
              network: "inherit",
              argv: python
                ? [
                    "uv",
                    "run",
                    "--locked",
                    "--no-sync",
                    "python",
                    "-c",
                    "import idna; print(idna.encode('example.com').decode())",
                  ]
                : ["node", "-e", "console.log(require('is-number')('3'))"],
              exitCode: 0,
              stdout: [{ kind: "equals", value: python ? "example.com\n" : "true\n" }],
              stderr: [],
            },
          },
        ],
        immutablePaths: [python ? "test_behavior.py" : "behavior.test.cjs"],
      }),
    );
    const report = JSON.parse(
      run(
        [
          process.execPath,
          cli,
          "ci",
          "--workspace",
          cwd,
          "--base",
          base,
          "--branch",
          head,
          "--goal-contract",
          contract,
          "--install",
          "--json",
        ],
        cwd,
      ),
    );
    if (!report.verified || !report.install.succeeded)
      throw Error(`${manager} upgrade was not verified`);
    writeManifest(version, true);
    git(["commit", "-qam", "tampered policy control"], cwd);
    run(
      [
        process.execPath,
        cli,
        "ci",
        "--workspace",
        cwd,
        "--base",
        base,
        "--branch",
        "HEAD",
        "--goal-contract",
        contract,
        "--install",
        "--json",
      ],
      cwd,
      1,
    );
    if (!observations.at(-1).stderr.includes("unrelated manifest"))
      throw Error("tampering failed for an unexpected reason");
  }
  console.log(JSON.stringify({ root, status: "passed", observations: observations.length }));
} catch (cause) {
  console.error(`preset evidence: ${root}`);
  throw cause;
}
