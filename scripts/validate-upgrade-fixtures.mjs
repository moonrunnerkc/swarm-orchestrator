import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const parent = join(homedir(), ".swarm", "upgrade-validation");
mkdirSync(parent, { recursive: true, mode: 0o700 });
const scratch = mkdtempSync(join(parent, "matrix-"));
const environment = { PATH: process.env.PATH, HOME: join(scratch, "home"), NO_COLOR: "1" };
mkdirSync(environment.HOME, { mode: 0o700 });
const observations = [];
function run(file, args, cwd, expected = 0, hostRuntime = false) {
  const result = spawnSync(file, args, {
    cwd,
    env: hostRuntime ? { ...environment, HOME: homedir() } : environment,
    encoding: "utf8",
    timeout: 300000,
    maxBuffer: 8000000,
  });
  observations.push({
    file,
    args,
    cwd,
    exit: result.status,
    expected,
    stdout: (result.stdout ?? "").slice(-2000),
    stderr: (result.stderr ?? "").slice(-2000),
  });
  writeFileSync(join(scratch, "results.json"), JSON.stringify(observations, null, 2), {
    mode: 0o600,
  });
  if (result.status !== expected)
    throw new Error(
      `${file} ${args.join(" ")} exited ${result.status}, expected ${expected}: ${result.stderr}`,
    );
  return result.stdout;
}
const git = (args, cwd) =>
  run(
    "git",
    ["-c", "user.name=Swarm fixture", "-c", "user.email=fixture@example.test", ...args],
    cwd,
  ).trim();
try {
  run("npm", ["run", "build"], root);
  run("npm", ["run", "build:verify"], root);
  const installs = new Map();
  for (const [binary, directory] of [
    ["swarm", root],
    ["swarm-verify", join(root, "packages/swarm-verify")],
  ]) {
    const install = join(scratch, binary);
    installs.set(binary, install);
    mkdirSync(install);
    writeFileSync(join(install, "package.json"), '{"private":true}');
    const output = run("npm", ["pack", "--json", "--pack-destination", scratch], directory);
    const metadata = JSON.parse(output.slice(output.indexOf("[")))[0];
    run(
      "npm",
      ["install", "--ignore-scripts", "--no-audit", "--no-fund", join(scratch, metadata.filename)],
      install,
    );
  }
  const node = join(scratch, "node");
  mkdirSync(node);
  writeFileSync(
    join(node, "package.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      type: "module",
      scripts: { test: "node --test" },
    }),
  );
  writeFileSync(join(node, "clamp.mjs"), "export const clamp = n => n;\n");
  writeFileSync(
    join(node, "clamp.test.mjs"),
    "import {test} from 'node:test';import assert from 'node:assert/strict';import {clamp} from './clamp.mjs';test('positive',()=>assert.equal(clamp(3),3));\n",
  );
  git(["init", "-q"], node);
  git(["add", "package.json", "clamp.mjs", "clamp.test.mjs"], node);
  git(["commit", "-qm", "base"], node);
  const base = git(["rev-parse", "HEAD"], node);
  writeFileSync(join(node, "clamp.mjs"), "export const clamp = n => Math.max(0,n);\n");
  git(["commit", "-qam", "fix clamp"], node);
  const head = git(["rev-parse", "HEAD"], node);
  const patch = join(scratch, "candidate.patch");
  writeFileSync(patch, run("git", ["diff", "--binary", "--full-index", base, head], node));
  const contract = join(scratch, "goal.json");
  writeFileSync(
    contract,
    JSON.stringify({
      version: 1,
      goal: "Clamp negative inputs",
      preset: { kind: "bugfix", reproducer: "negative" },
      requirements: [
        { id: "negative-input", description: "negative inputs return zero", checks: ["negative"] },
      ],
      checks: [
        {
          id: "negative",
          command: "pinned CLI output check",
          author: "model",
          exposure: "withheld",
          artifacts: [],
          behavior: {
            kind: "cli",
            cwd: ".",
            timeoutMs: 3000,
            maxOutputBytes: 4000,
            toolchain: "node24",
            network: "inherit",
            argv: [
              "node",
              "--input-type=module",
              "-e",
              "import {clamp} from './clamp.mjs'; console.log(clamp(-1))",
            ],
            stdin: "",
            exitCode: 0,
            stdout: [{ kind: "equals", value: "0\n" }],
            stderr: [],
          },
        },
      ],
      immutablePaths: ["clamp.test.mjs"],
    }),
  );
  writeFileSync(join(node, "personal.txt"), "preserve this untracked file");
  const results = [];
  for (const binary of ["swarm", "swarm-verify"])
    for (const mode of [
      ["--patch", patch],
      ["--branch", head],
    ]) {
      const out = run(
        join(installs.get(binary), "node_modules/.bin", binary),
        ["ci", "--workspace", node, "--base", base, ...mode, "--goal-contract", contract, "--json"],
        node,
      );
      const report = JSON.parse(out.trim());
      if (!report.verified || report.task !== "accepted" || report.regression !== "pass")
        throw new Error("good fixture was not accepted");
      const offline = run(
        join(installs.get(binary), "node_modules/.bin", binary),
        ["verify", report.bundleDirectory],
        node,
        1,
      );
      if (
        !offline.includes("integrity:  valid") ||
        !offline.includes("independent goal") ||
        !offline.includes("AGREES") ||
        !offline.includes("signer:     untrusted")
      )
        throw Error("offline integrity or independent goal derivation failed");
      results.push([report.verified, report.task, report.regression]);
    }
  if (
    new Set(results.map(JSON.stringify)).size !== 1 ||
    readFileSync(join(node, "personal.txt"), "utf8") !== "preserve this untracked file"
  )
    throw new Error("parity or preservation failed");
  const isolated = JSON.parse(
    run(
      join(installs.get("swarm-verify"), "node_modules/.bin/swarm-verify"),
      [
        "ci",
        "--workspace",
        node,
        "--base",
        base,
        "--branch",
        head,
        "--goal-contract",
        contract,
        "--isolation",
        "docker:node:24-bookworm",
        "--require-isolation",
        "--json",
      ],
      node,
      0,
      true,
    ),
  );
  if (!isolated.verified || isolated.executionTrust !== "isolated")
    throw Error("required container boundary was not observed");
  writeFileSync(join(node, "clamp.mjs"), "export const clamp = n => 7;\n");
  git(["commit", "-qam", "broken behavior"], node);
  const broken = JSON.parse(
    run(
      join(installs.get("swarm-verify"), "node_modules/.bin/swarm-verify"),
      [
        "ci",
        "--workspace",
        node,
        "--base",
        base,
        "--branch",
        "HEAD",
        "--goal-contract",
        contract,
        "--json",
      ],
      node,
      1,
    ),
  );
  if (broken.task !== "rejected" || broken.goalAcceptance?.checkResults?.[0]?.status !== "rejected")
    throw Error("negative control did not fail for the required behavior");
  console.log(JSON.stringify({ scratch, observations: observations.length, status: "passed" }));
} catch (error) {
  console.error(`fixture evidence: ${scratch}`);
  throw error;
}
