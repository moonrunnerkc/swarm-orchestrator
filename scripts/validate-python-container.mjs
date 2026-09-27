import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = mkdtempSync(join(homedir(), ".swarm/upgrade-validation/python-container-"));
const workspace = join(root, "candidate");
mkdirSync(workspace, { mode: 0o700 });
const observations = [];
function run(file, args, expected = 0) {
  const result = spawnSync(file, args, {
    cwd: workspace,
    env: { PATH: process.env.PATH, HOME: homedir(), NO_COLOR: "1" },
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 8000000,
  });
  observations.push({
    file,
    args,
    expected,
    exit: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  });
  writeFileSync(join(root, "observations.json"), JSON.stringify(observations, null, 2), {
    mode: 0o600,
  });
  if (result.status !== expected)
    throw Error(
      `Python container fixture ${root}: expected ${expected}, got ${result.status}: ${result.stderr}`,
    );
  return result.stdout;
}
const git = (...args) =>
  run("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.test", ...args]).trim();
writeFileSync(
  join(workspace, "pyproject.toml"),
  '[project]\nname="python-container-fixture"\nversion="0.1.0"\nrequires-python=">=3.11"\ndependencies=["pytest==9.0.2"]\n[tool.pytest.ini_options]\ntestpaths=["."]\n',
);
writeFileSync(join(workspace, ".gitignore"), ".venv/\n__pycache__/\n.pytest_cache/\n");
writeFileSync(join(workspace, "app.py"), "def value():\n    return 1\n");
writeFileSync(join(workspace, "test_app.py"), "def test_runtime():\n    assert 1 + 1 == 2\n");
run("uv", ["lock"]);
git("init", "-q");
git("add", "--all");
git("commit", "-qm", "base Python behavior");
const base = git("rev-parse", "HEAD");
const contract = join(root, "goal.json");
writeFileSync(
  contract,
  JSON.stringify({
    version: 1,
    goal: "Preserve Python return value",
    preset: { kind: "refactor" },
    requirements: [{ id: "value", description: "value returns one", checks: ["value"] }],
    checks: [
      {
        id: "value",
        command: "pinned Python result",
        author: "model",
        exposure: "withheld",
        artifacts: [],
        behavior: {
          kind: "cli",
          cwd: ".",
          timeoutMs: 5000,
          maxOutputBytes: 4000,
          toolchain: "uv 0.11.13 with project Python",
          network: "inherit",
          argv: [
            "uv",
            "run",
            "--locked",
            "--no-sync",
            "python",
            "-c",
            "from app import value; print(value())",
          ],
          exitCode: 0,
          stdout: [{ kind: "equals", value: "1\n" }],
          stderr: [],
        },
      },
    ],
    immutablePaths: ["pyproject.toml", "uv.lock", "test_app.py"],
  }),
);
for (const value of [1, 2]) {
  writeFileSync(
    join(workspace, "app.py"),
    `def value():\n    answer = ${value}\n    return answer\n`,
  );
  git("commit", "-qam", `return ${value}`);
  for (const binary of [
    process.argv[2] ?? resolve("dist/cli.js"),
    process.argv[3] ?? resolve("packages/swarm-verify/dist/swarm-verify.js"),
  ]) {
    const report = JSON.parse(
      run(
        process.execPath,
        [
          binary,
          "ci",
          "--workspace",
          workspace,
          "--base",
          base,
          "--branch",
          "HEAD",
          "--goal-contract",
          contract,
          "--install",
          "--isolation",
          "docker:swarm-upgrade-python:20260927",
          "--require-isolation",
          "--json",
        ],
        value === 1 ? 0 : 1,
      ),
    );
    if (
      report.executionTrust !== "isolated" ||
      report.regression !== "pass" ||
      report.task !== (value === 1 ? "accepted" : "rejected")
    )
      throw Error(`Python result mismatch: ${root}`);
  }
}
console.log(JSON.stringify({ root, observations: observations.length, status: "passed" }));
