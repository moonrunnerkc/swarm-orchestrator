import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkSchemaName } from "./cli-check.ts";

const run = promisify(execFile);

/**
 * The first-run command, driven through the standalone binary's entry point with no
 * subcommand, under an environment holding no key and no configuration. Every fixture is a
 * real repository and every run is a real process, because what this command promises is a
 * result with nothing configured, and the only way to hold it to that is to configure nothing.
 */
let scratch = "";

async function repository(name: string, files: Readonly<Record<string, string>>): Promise<string> {
  const root = join(scratch, name);
  await mkdir(root, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }
  const git = (args: readonly string[]) =>
    run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: root });
  await git(["init", "-q"]);
  await git(["add", "-A"]);
  await git(["commit", "-qm", "base"]);
  return root;
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

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-check-"));
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function verifier(
  args: readonly string[],
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  const environment = {
    PATH: process.env.PATH ?? "",
    HOME: join(scratch, "home"),
    NO_COLOR: "1",
    SWARM_LOCAL_BASE_URL: "http://127.0.0.1:9",
  };
  try {
    const ran = await run(process.execPath, [resolve("src/swarm-verify.ts"), ...args], {
      env: environment,
      timeout: 120_000,
      maxBuffer: 8_000_000,
    });
    return { code: 0, stdout: ran.stdout, stderr: ran.stderr };
  } catch (cause) {
    const failed = cause as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
  }
}

describe("swarm-verify with no subcommand", () => {
  it("checks a repository, prints five conclusions, and exits 0 as a regression-only pass", async () => {
    const root = await repository("passing", nodeTestFixture);
    const ran = await verifier(["--workspace", root]);
    expect(ran.stdout).toContain("command      npm run --silent test [node --test]");
    expect(ran.stdout).toContain("ran: exited 0");
    expect(ran.stdout).toMatch(/^checks {7}passed \d+ \(tests/m);
    expect(ran.stdout).toContain("execution    restricted");
    expect(ran.stdout).toContain("requirements unmeasured");
    expect(ran.stdout).toContain("challenges   none");
    expect(ran.stdout).toContain("result       regression-only pass");
    expect(ran.stdout).toContain("evidence     ");
    expect(ran.code).toBe(0);
    // Nothing was written into the workspace: no swarm.toml, no bundle, no scratch.
    expect((await readdir(root)).sort()).toEqual([
      ".git",
      "double.mjs",
      "double.test.mjs",
      "package.json",
    ]);
  });

  it("emits one versioned JSON object under --json with the same conclusions", async () => {
    const root = await repository("json", nodeTestFixture);
    const ran = await verifier(["--workspace", root, "--json"]);
    const report = JSON.parse(ran.stdout.trim()) as {
      schema: string;
      result: string;
      exitCode: number;
      plan: { tests: { runner: string } };
      conclusions: {
        checks: readonly { id: string; status: string }[];
        command: { status: string };
      };
    };
    expect(report.schema).toBe(checkSchemaName);
    expect(report.result).toBe("pass");
    expect(report.exitCode).toBe(0);
    expect(report.plan.tests.runner).toBe("node-test");
    expect(report.conclusions.command.status).toBe("ran");
    expect(report.conclusions.checks.find((one) => one.id === "tests")?.status).toBe("passed");
    expect(ran.code).toBe(0);
  });

  it("exits 1 when a declared check fails, and says which", async () => {
    const root = await repository("failing", {
      ...nodeTestFixture,
      "double.mjs": "export const double = (n) => n + n + 1;\n",
    });
    const ran = await verifier(["--workspace", root]);
    expect(ran.stdout).toContain("failed 1 (tests)");
    expect(ran.stdout).toContain("result       fail");
    expect(ran.code).toBe(1);
  });

  it("runs a vitest project once under CI=true and reads its structured outcome", async () => {
    const root = await repository("vitest", {
      "package.json":
        '{ "name": "v", "type": "module", "scripts": { "test": "vitest" }, "devDependencies": { "vitest": "4.1.11" } }\n',
      "triple.mjs": "export const triple = (n) => n * 3;\n",
      "triple.test.mjs": [
        'import { expect, test } from "vitest";',
        'import { triple } from "./triple.mjs";',
        'test("triples", () => expect(triple(2)).toBe(6));',
        "",
      ].join("\n"),
      ".gitignore": "node_modules\n",
    });
    await symlink(resolve("node_modules"), join(root, "node_modules"), "dir");
    const ran = await verifier(["--workspace", root]);
    expect(ran.stdout).toContain("CI=true, which vitest reads as run mode");
    expect(ran.stdout).toContain("1 runner-reported tests, 1 executed");
    expect(ran.code).toBe(0);
  });

  it("exits 4 without running a test script that asks for watch mode", async () => {
    const root = await repository("watch", {
      "package.json": '{ "name": "w", "scripts": { "test": "vitest --watch" } }\n',
    });
    const ran = await verifier(["--workspace", root]);
    expect(ran.stdout).toContain("asks for watch mode (--watch)");
    expect(ran.stdout).toContain("result       incomplete");
    expect(ran.code).toBe(4);
  });

  it("exits 4 with the exact next step when dependencies are declared and not installed", async () => {
    const root = await repository("uninstalled", {
      "package.json":
        '{ "name": "u", "scripts": { "test": "vitest" }, "devDependencies": { "vitest": "4.1.11" } }\n',
      "package-lock.json": "{}\n",
    });
    const ran = await verifier(["--workspace", root]);
    expect(ran.stdout).toContain("run `npm ci` in the workspace, then run again");
    expect(ran.code).toBe(4);
  });

  it("exits 4 for a directory with no manifest and for a directory that is not a repository", async () => {
    const bare = await repository("bare", { "README.md": "hello\n" });
    const noManifest = await verifier(["--workspace", bare]);
    expect(noManifest.stdout).toContain("no package.json, pyproject.toml");
    expect(noManifest.code).toBe(4);

    const plain = join(scratch, "plain");
    await mkdir(plain, { recursive: true });
    await writeFile(join(plain, "package.json"), '{ "scripts": { "test": "node --test" } }\n');
    const notGit = await verifier(["--workspace", plain]);
    expect(notGit.stdout).toContain("not a git repository");
    expect(notGit.code).toBe(4);
  });

  it("names the packages and the override when a workspace has no root test script", async () => {
    const root = await repository("monorepo", {
      "package.json": '{ "name": "m", "workspaces": ["packages/*"] }\n',
      "packages/a/package.json": '{ "name": "a", "scripts": { "test": "node --test" } }\n',
    });
    const ran = await verifier(["--workspace", root]);
    expect(ran.stdout).toContain("--package <dir>: packages/a");
    expect(ran.code).toBe(4);
  });

  it("prints the plan and runs nothing under --explain", async () => {
    const root = await repository("explain", nodeTestFixture);
    const ran = await verifier(["--workspace", root, "--explain"]);
    expect(ran.stdout).toContain("result       preview only; nothing ran (exit 0)");
    expect(ran.stdout).not.toContain("evidence     ");
    expect(ran.code).toBe(0);
  });

  it("exits 2 for a command line it cannot read", async () => {
    const ran = await verifier(["nonsense"]);
    expect(ran.stderr).toContain('"nonsense" is not a command this binary has');
    expect(ran.code).toBe(2);
  });
});
