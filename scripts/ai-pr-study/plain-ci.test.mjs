import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bundleEvidence,
  collectedCount,
  detectProject,
  missingCommands,
  plainSuite,
  prepareDependencies,
  suiteStatus,
} from "./plain-ci.mjs";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "plain-ci-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const write = (name, contents) => {
  mkdirSync(join(root, name, ".."), { recursive: true });
  writeFileSync(join(root, name), contents);
};

describe("detectProject", () => {
  it("reads the declared npm test script and the lockfile's installer", () => {
    write(
      "package.json",
      JSON.stringify({ scripts: { test: "vitest run" }, devDependencies: { vitest: "1" } }),
    );
    write("package-lock.json", "{}");
    expect(detectProject(root)).toMatchObject({
      manifest: "package.json",
      lockfile: "package-lock.json",
      installCommand: "npm ci --ignore-scripts --no-audit --no-fund",
      testCommand: "npm test",
    });
  });

  it("uses pnpm for a pnpm lockfile and refuses to pick between two lockfiles", () => {
    write("package.json", JSON.stringify({ scripts: { test: "node --test" } }));
    write("pnpm-lock.yaml", "");
    // pnpm is installed into the checkout while the registry is reachable; the test command
    // then needs no network.
    expect(detectProject(root)).toMatchObject({
      testCommand: "pnpm test",
      installCommand:
        "npm install --no-save --no-audit --no-fund --prefix .study-tools pnpm@10 && .study-tools/node_modules/.bin/pnpm install --frozen-lockfile --ignore-scripts",
    });
    write("package-lock.json", "{}");
    expect(detectProject(root)).toMatchObject({ testCommand: null, installCommand: null });
    expect(detectProject(root).reason).toMatch(/several lockfiles/);
  });

  it("says when no test command is declared, including npm's placeholder", () => {
    write(
      "package.json",
      JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }),
    );
    expect(detectProject(root)).toMatchObject({
      testCommand: null,
      reason: "package.json declares no test script",
    });
  });

  it("runs pytest for a uv project that declares it, and nothing for one that does not", () => {
    write("pyproject.toml", '[project]\nname = "x"\ndependencies = ["httpx"]\n');
    write("uv.lock", "");
    expect(detectProject(root).testCommand).toBeNull();
    write("pyproject.toml", '[project]\nname = "x"\n[dependency-groups]\ndev = ["pytest>=8"]\n');
    expect(detectProject(root)).toMatchObject({
      testCommand: "python -m pytest",
      installCommand: "uv sync --locked --all-groups --all-extras",
    });
  });

  it("names a repository with no supported manifest", () => {
    expect(detectProject(root)).toMatchObject({ manifest: null, testCommand: null });
  });
});

describe("collectedCount", () => {
  it("reads each runner's own summary", () => {
    expect(collectedCount("===== 3 passed, 1 failed, 2 skipped in 0.52s =====")).toBe(6);
    expect(collectedCount("collected 0 items\n===== no tests ran in 0.01s =====")).toBe(0);
    expect(collectedCount(" Test Files  2 passed (2)\n      Tests  7 passed | 1 skipped (8)")).toBe(
      8,
    );
    expect(collectedCount("Tests:       1 failed, 4 passed, 5 total")).toBe(5);
    expect(collectedCount("# tests 12\n# pass 12")).toBe(12);
    expect(collectedCount("  4 passing (20ms)\n  1 failing")).toBe(5);
    expect(collectedCount("No test files found, exiting with code 1")).toBe(0);
    expect(collectedCount("done")).toBeNull();
  });
});

describe("suiteStatus", () => {
  it("keeps setup failure, no collection, and the command's outcome apart", () => {
    expect(suiteStatus({ setupFailed: true, testCommand: "npm test" })).toBe("setup-failed");
    expect(suiteStatus({ setupFailed: false, testCommand: null })).toBe("not-collected");
    expect(suiteStatus({ testCommand: "npm test", exitCode: 0, collected: 0 })).toBe(
      "not-collected",
    );
    expect(suiteStatus({ testCommand: "python -m pytest", exitCode: 5, collected: null })).toBe(
      "not-collected",
    );
    expect(suiteStatus({ testCommand: "npm test", exitCode: 0, collected: 4 })).toBe("passed");
    expect(suiteStatus({ testCommand: "npm test", exitCode: 1, collected: 4 })).toBe("failed");
    expect(
      suiteStatus({ testCommand: "npm test", exitCode: null, timedOut: true, collected: null }),
    ).toBe("failed");
  });
});

describe("dependency preparation and the suite, over a recorded container runner", () => {
  const recorder = (answers) => {
    const calls = [];
    const run = (command, args) => {
      calls.push([command, ...args].join(" "));
      if (args[0] === "image")
        return { status: 0, stdout: 'sha256:abc ["node@sha256:def"]', stderr: "" };
      return answers.shift();
    };
    return { calls, run };
  };

  it("records the install and the environment, and a failed install is setup-failed, never failed", () => {
    write(
      "package.json",
      JSON.stringify({ scripts: { test: "node --test" }, dependencies: { a: "1" } }),
    );
    write("package-lock.json", "{}");
    const { calls, run } = recorder([{ status: 1, stdout: "", stderr: "npm ERR! code E404" }]);
    const measured = plainSuite(root, {
      image: "node:24",
      installTimeoutMs: 1000,
      testTimeoutMs: 1000,
      run,
    });
    expect(measured.suite.status).toBe("setup-failed");
    expect(measured.setup.install).toMatchObject({
      status: "failed",
      exitCode: 1,
      command: "npm ci --ignore-scripts --no-audit --no-fund",
    });
    expect(measured.setup.install.lockfileDigest).toBe(
      `sha256:${createHash("sha256").update("{}").digest("hex")}`,
    );
    expect(measured.setup.environment.image).toMatchObject({
      id: "sha256:abc",
      repoDigests: ["node@sha256:def"],
    });
    expect(calls.some((call) => call.includes("--network=none"))).toBe(false);
  });

  it("reads a test command that needed the registry as setup, not as a failed suite", () => {
    write(
      "package.json",
      JSON.stringify({ scripts: { test: "vitest" }, dependencies: { a: "1" } }),
    );
    write("package-lock.json", "{}");
    const { run } = recorder([
      { status: 0, stdout: "added 1", stderr: "" },
      {
        status: 1,
        stdout: "",
        stderr:
          "npm error request to https://registry.npmjs.org/pnpm failed, reason: getaddrinfo EAI_AGAIN registry.npmjs.org",
      },
    ]);
    const measured = plainSuite(root, {
      image: "node:24",
      installTimeoutMs: 1000,
      testTimeoutMs: 1000,
      run,
    });
    expect(measured.suite.status).toBe("setup-failed");
    expect(measured.suite.reason).toMatch(/network off/);
  });

  it("names system commands the image lacks without changing a real failure", () => {
    write(
      "package.json",
      JSON.stringify({ scripts: { test: "vitest" }, dependencies: { a: "1" } }),
    );
    write("package-lock.json", "{}");
    const { run } = recorder([
      { status: 0, stdout: "added 1", stderr: "" },
      {
        status: 1,
        stdout: "/bin/sh: 1: sqlite3: not found\n      Tests  5 failed | 154 passed (159)",
        stderr: "",
      },
    ]);
    const measured = plainSuite(root, {
      image: "node:24",
      installTimeoutMs: 1000,
      testTimeoutMs: 1000,
      run,
    });
    expect(measured.suite).toMatchObject({
      status: "failed",
      collected: 159,
      environmentGaps: ["sqlite3"],
    });
    expect(missingCommands("bash: jq: command not found\nsh: 2: git: not found")).toEqual([
      "git",
      "jq",
    ]);
  });

  it("runs the declared command with the network off and the project's bin first", () => {
    write(
      "package.json",
      JSON.stringify({ scripts: { test: "node --test" }, dependencies: { a: "1" } }),
    );
    write("package-lock.json", "{}");
    const { calls, run } = recorder([
      { status: 0, stdout: "added 1", stderr: "" },
      { status: 0, stdout: "# tests 3\n# pass 3", stderr: "" },
    ]);
    const measured = plainSuite(root, {
      image: "node:24",
      installTimeoutMs: 1000,
      testTimeoutMs: 1000,
      run,
    });
    expect(measured.suite).toMatchObject({
      status: "passed",
      collected: 3,
      command: "npm test",
      exitCode: 0,
    });
    const testCall = calls.find((call) => call.includes("--network=none"));
    expect(testCall).toContain(
      "PATH=/workspace/.venv/bin:/workspace/node_modules/.bin:/workspace/.study-tools/node_modules/.bin:$PATH; npm test",
    );
  });

  it("needs no install for a manifest without dependencies, and fails setup for dependencies with no lockfile", () => {
    write("package.json", JSON.stringify({ scripts: { test: "node --test" } }));
    const none = prepareDependencies(root, "node:24", detectProject(root), { timeoutMs: 1000 });
    expect(none.status).toBe("not-needed");
    write(
      "package.json",
      JSON.stringify({ scripts: { test: "node --test" }, dependencies: { a: "1" } }),
    );
    const missing = prepareDependencies(root, "node:24", detectProject(root), { timeoutMs: 1000 });
    expect(missing.status).toBe("failed");
  });
});

describe("bundleEvidence", () => {
  // A bundle whose embedded verifier recomputes a digest over its payload, as the real ones do.
  const makeBundle = () => {
    const bundle = join(root, "bundle");
    mkdirSync(bundle);
    const payload = "ledger line 1\n";
    writeFileSync(join(bundle, "ledger.jsonl"), payload);
    writeFileSync(join(bundle, "digest.txt"), createHash("sha256").update(payload).digest("hex"));
    writeFileSync(
      join(bundle, "verify.mjs"),
      [
        'import { createHash } from "node:crypto";',
        'import { readFileSync } from "node:fs";',
        'const ok = createHash("sha256").update(readFileSync("ledger.jsonl")).digest("hex") === readFileSync("digest.txt", "utf8");',
        'console.log(ok ? "bundle verified: every check passed" : "FAIL ledger digest");',
        "process.exit(ok ? 0 : 1);",
      ].join("\n"),
    );
    return bundle;
  };

  it("is valid when the bundle's own verifier passes and invalid once a byte changes", () => {
    const bundle = makeBundle();
    expect(bundleEvidence(bundle)).toMatchObject({ valid: true });
    writeFileSync(join(bundle, "ledger.jsonl"), "ledger line 1 doctored\n");
    const corrupted = bundleEvidence(bundle);
    expect(corrupted.valid).toBe(false);
    expect(corrupted.detail).toMatch(/verify\.mjs exited 1: FAIL ledger digest/);
  });

  it("is invalid with the reason when there is no bundle or no verifier", () => {
    expect(bundleEvidence(null)).toEqual({ valid: false, detail: "no bundle was exported" });
    mkdirSync(join(root, "empty"));
    expect(bundleEvidence(join(root, "empty")).detail).toBe("the bundle carries no verify.mjs");
  });
});
