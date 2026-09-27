#!/usr/bin/env node
/**
 * The installed standalone verifier, exercised on the runtime and platform it was installed on,
 * with nothing of this repository beside it but the committed bundle and the tamper demo.
 *
 *   node scripts/verifier-matrix-smoke.mjs <install directory> <repository root>
 *
 * The install directory holds `node_modules/swarm-verify` from a tarball. This script uses
 * node's builtins only, so the consumer runtime under test is the one that runs it. Every
 * case names what it expects, and a case the platform cannot run is recorded as unsupported
 * by name rather than skipped in silence: on Windows the project checks need a POSIX shell,
 * so only bundle verification is exercised there, and the contract says so.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [installDirectory, repositoryRoot] = process.argv.slice(2).map((p) => resolve(p));
if (!installDirectory || !repositoryRoot) {
  console.error("usage: verifier-matrix-smoke.mjs <install directory> <repository root>");
  process.exit(2);
}
const entry = join(installDirectory, "node_modules", "swarm-verify", "dist", "swarm-verify.js");
if (!existsSync(entry)) {
  console.error(`the package is not installed at ${entry}; install the tarball first`);
  process.exit(2);
}
const scratch = mkdtempSync(join(tmpdir(), "swarm-verify-matrix-"));
const home = join(scratch, "home");
mkdirSync(home);
const windows = process.platform === "win32";
const results = [];

function run(args, cwd = scratch) {
  const ran = spawnSync(process.execPath, [entry, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 300_000,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: home,
      USERPROFILE: home,
      NO_COLOR: "1",
      SWARM_LOCAL_BASE_URL: "http://127.0.0.1:9",
      ...(windows
        ? { SystemRoot: process.env.SystemRoot ?? "", PATHEXT: process.env.PATHEXT ?? "" }
        : {}),
    },
  });
  return { code: ran.status, stdout: ran.stdout ?? "", stderr: ran.stderr ?? "" };
}

function git(cwd, args) {
  const ran = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home },
  });
  if (ran.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${ran.stderr}`);
}

function repository(name, files) {
  const root = join(scratch, name);
  mkdirSync(root, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  git(root, ["init", "-q"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "base"]);
  return root;
}

function expect(name, ran, expected) {
  const codeOk = expected.exits.includes(ran.code);
  const textOk =
    expected.pattern === undefined || expected.pattern.test(`${ran.stdout}${ran.stderr}`);
  const loadOk = !/ERR_MODULE_NOT_FOUND|Cannot find module|SyntaxError|TypeError/.test(
    `${ran.stdout}${ran.stderr}`,
  );
  const ok = codeOk && textOk && loadOk;
  results.push({ name, ok, code: ran.code, expected: expected.exits.join("/") });
  if (!ok) {
    console.error(
      `FAIL ${name}: exit ${ran.code}, expected ${expected.exits.join("/")} and ${expected.pattern ?? "any output"}`,
    );
    console.error(`${ran.stdout}\n${ran.stderr}`.slice(0, 6000));
  } else console.log(`ok   ${name}: exit ${ran.code}`);
}

function unsupported(name, reason) {
  results.push({ name, ok: true, unsupported: reason });
  console.log(`n/a  ${name}: ${reason}`);
}

const nodeTestFixture = {
  "package.json":
    '{ "name": "w", "version": "1.0.0", "type": "module", "scripts": { "test": "node --test" } }\n',
  "double.mjs": "export const double = (n) => n * 2;\n",
  "double.test.mjs": [
    'import test from "node:test";',
    'import assert from "node:assert/strict";',
    'import { double } from "./double.mjs";',
    'test("doubles", () => assert.equal(double(2), 4));',
    "",
  ].join("\n"),
};

try {
  console.log(`node ${process.version} on ${process.platform}/${process.arch}, entry ${entry}`);
  expect("--version prints the package version", run(["--version"]), {
    exits: [0],
    pattern: /^\d+\.\d+\.\d+/m,
  });
  const help = run(["--help"]);
  expect("--help prints the four commands", help, {
    exits: [0],
    pattern:
      /^(?=[\s\S]*swarm-verify check)(?=[\s\S]*swarm-verify verify)(?=[\s\S]*swarm-verify ci)(?=[\s\S]*swarm-verify gates)/,
  });
  expect("an unknown command exits 2", run(["nonsense"]), {
    exits: [2],
    pattern: /is not a command this binary has/,
  });

  const bundle = join(repositoryRoot, "docs", "evidence", "2026-08-18", "live-frontier");
  const signer = "sha256:db270183c40c65843cacd2b3dcf20ee249d146d98c56699b2f3512ebeb84a52a";
  expect(
    "verify accepts the committed bundle with its expected signer",
    run(["verify", bundle, "--signer", signer]),
    {
      exits: [0],
      pattern: /integrity: {2}valid[\s\S]*signer: {5}trusted/,
    },
  );
  expect("verify exits 1 for a bundle whose signer was not named", run(["verify", bundle]), {
    exits: [1],
    pattern: /signer: {5}untrusted/,
  });
  const tampered = join(scratch, "tampered");
  const flipped = spawnSync(
    process.execPath,
    [
      join(repositoryRoot, "docs", "evidence", "2026-08-18", "tamper-demo", "flip-one-byte.mjs"),
      bundle,
      tampered,
    ],
    { encoding: "utf8" },
  );
  if (flipped.status !== 0) throw new Error(`tamper demo failed: ${flipped.stderr}`);
  expect(
    "verify refuses the bundle one byte later",
    run(["verify", tampered, "--signer", signer]),
    {
      exits: [1],
      pattern: /integrity: {2}invalid/,
    },
  );
  expect(
    "verify exits 2 for a directory that is no bundle",
    run(["verify", join(scratch, "absent")]),
    {
      exits: [2],
      pattern: /integrity:.*unverified/,
    },
  );

  if (windows) {
    unsupported(
      "check on a node --test project",
      "project checks need a POSIX shell (/bin/sh); use WSL",
    );
    unsupported("check on a failing project", "same");
    unsupported("check with no manifest", "same");
    unsupported("ci --patch", "same");
    unsupported("gates", "same");
  } else {
    const passing = repository("passing", nodeTestFixture);
    expect("check passes a node --test project as regression-only", run(["--workspace", passing]), {
      exits: [0],
      pattern: /ran: exited 0[\s\S]*result {7}regression-only pass/,
    });
    const asJson = run(["check", "--workspace", passing, "--json"]);
    expect("check --json emits swarm.check.v1", asJson, {
      exits: [0],
      pattern: /"schema":"swarm\.check\.v1"/,
    });
    const report = JSON.parse(asJson.stdout.trim());
    if (report.result !== "pass" || report.conclusions.requirements.status !== "unmeasured")
      throw new Error("check --json disagrees with the text rendering");
    const bundleWritten = existsSync(join(report.bundleDirectory, "verify.mjs"));
    results.push({ name: "check wrote a bundle carrying its own verifier", ok: bundleWritten });
    if (!bundleWritten) console.error("FAIL check wrote no bundle");
    else console.log("ok   check wrote a bundle carrying its own verifier");
    const own = spawnSync(
      process.execPath,
      [join(report.bundleDirectory, "verify.mjs"), report.bundleDirectory],
      { encoding: "utf8" },
    );
    results.push({
      name: "the check bundle verifies under its own verifier",
      ok: own.status === 0,
    });
    console.log(
      `${own.status === 0 ? "ok  " : "FAIL"} the check bundle verifies under its own verifier (exit ${own.status})`,
    );

    const failing = repository("failing", {
      ...nodeTestFixture,
      "double.mjs": "export const double = (n) => n + n + 1;\n",
    });
    expect("check exits 1 when the suite fails", run(["--workspace", failing]), {
      exits: [1],
      pattern: /failed 1 \(tests\)/,
    });
    const bare = repository("bare", { "README.md": "hello\n" });
    expect("check exits 4 with no manifest", run(["--workspace", bare]), {
      exits: [4],
      pattern: /incomplete/,
    });
    expect("check --explain runs nothing", run(["--explain", "--workspace", passing]), {
      exits: [0],
      pattern: /preview only; nothing ran/,
    });

    const patch = join(scratch, "candidate.diff");
    writeFileSync(join(passing, "double.mjs"), "export const double = (n) => n + n;\n");
    const diff = spawnSync("git", ["diff"], { cwd: passing, encoding: "utf8" });
    writeFileSync(patch, diff.stdout);
    git(passing, ["checkout", "--", "double.mjs"]);
    expect(
      "ci --patch verifies in a fresh checkout and leaves the task unjudged",
      run(["ci", "--patch", patch, "--workspace", passing]),
      {
        exits: [1],
        pattern: /regression: pass[\s\S]*task: unjudged/,
      },
    );
    expect("gates measures the workspace", run(["gates", "--workspace", passing]), {
      exits: [0],
      pattern: /acceptable: yes/,
    });
  }

  const manifest = JSON.parse(
    readFileSync(join(installDirectory, "node_modules", "swarm-verify", "package.json"), "utf8"),
  );
  const dependencies = Object.keys(manifest.dependencies ?? {}).sort();
  const closureOk = dependencies.join(",") === "smol-toml,zod";
  results.push({ name: "the dependency closure is smol-toml and zod", ok: closureOk });
  console.log(`${closureOk ? "ok  " : "FAIL"} dependencies: ${dependencies.join(", ")}`);
  const licensed = existsSync(join(installDirectory, "node_modules", "swarm-verify", "LICENSE"));
  results.push({ name: "the license ships in the package", ok: licensed });
  console.log(`${licensed ? "ok  " : "FAIL"} LICENSE present`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const failed = results.filter((one) => !one.ok);
console.log(
  `\n${results.length - failed.length} of ${results.length} case(s) as expected on node ${process.version} ${process.platform}/${process.arch}` +
    `${results.some((one) => one.unsupported) ? `, ${results.filter((one) => one.unsupported).length} recorded unsupported on this platform` : ""}`,
);
process.exit(failed.length === 0 ? 0 : 1);
