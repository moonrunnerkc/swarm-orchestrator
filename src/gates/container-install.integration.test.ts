import { execFile, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const run = promisify(execFile);

/**
 * An authorized lockfile install inside the container reaches the registry for that one
 * command, with lifecycle scripts off, and every check that follows runs with the network off.
 * Held by a real docker run over a fixture with one registry dependency: the install record
 * names the registry, the tests gate passes in the network-disabled container, and the
 * containment self-test still measures `isolated`.
 */
function dockerAnswers(): boolean {
  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      stdio: "ignore",
      timeout: 15_000,
    });
    return true;
  } catch {
    return false;
  }
}

const docker = dockerAnswers();
let scratch = "";
let workspace = "";
let head = "";
let base = "";

async function git(args: readonly string[]): Promise<string> {
  const ran = await run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd: workspace,
  });
  return ran.stdout.trim();
}

beforeAll(async () => {
  if (!docker) return;
  // Under the repository rather than the system temp directory: Docker Desktop shares the
  // former with containers and not the latter.
  await mkdir(resolve(".swarm"), { recursive: true });
  scratch = await mkdtemp(join(resolve(".swarm"), "container-install-"));
  workspace = join(scratch, "repo");
  await mkdir(workspace);
  await git(["init", "-q", "-b", "main"]);
  await writeFile(
    join(workspace, "package.json"),
    '{ "name": "d", "version": "1.0.0", "type": "module", "scripts": { "test": "node --test" }, "dependencies": { "is-odd": "3.0.1" } }\n',
  );
  await writeFile(join(workspace, ".gitignore"), "node_modules\n");
  await writeFile(
    join(workspace, "odd.mjs"),
    'import isOdd from "is-odd";\nexport const odd = (n) => isOdd(n);\n',
  );
  await writeFile(
    join(workspace, "odd.test.mjs"),
    'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { odd } from "./odd.mjs";\ntest("odd", () => assert.equal(odd(3), true));\n',
  );
  await run(
    "npm",
    ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: workspace },
  );
  await git(["add", "-A"]);
  await git(["commit", "-qm", "base"]);
  base = await git(["rev-parse", "HEAD"]);
  await writeFile(
    join(workspace, "odd.mjs"),
    'import isOdd from "is-odd";\nexport const odd = (n) => Boolean(isOdd(n));\n',
  );
  await git(["commit", "-qam", "change"]);
  head = await git(["rev-parse", "HEAD"]);
});

afterAll(async () => {
  if (scratch.length > 0) await rm(scratch, { recursive: true, force: true });
});

describe.skipIf(!docker)("an authorized pnpm install where the image carries no pnpm", () => {
  it("fetches the declared pnpm through npm for the install command only, and records that vector", async () => {
    const repo = join(scratch, "pnpm-repo");
    await mkdir(repo);
    const gitIn = (args: readonly string[]) =>
      run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: repo });
    await gitIn(["init", "-q", "-b", "main"]);
    await writeFile(
      join(repo, "package.json"),
      '{ "name": "p", "version": "1.0.0", "type": "module", "packageManager": "pnpm@9.15.0", "scripts": { "test": "node --test" }, "dependencies": { "is-odd": "3.0.1" } }\n',
    );
    await writeFile(join(repo, ".gitignore"), "node_modules\n");
    await writeFile(
      join(repo, "odd.mjs"),
      'import isOdd from "is-odd";\nexport const odd = (n) => isOdd(n);\n',
    );
    await writeFile(
      join(repo, "odd.test.mjs"),
      'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { odd } from "./odd.mjs";\ntest("odd", () => assert.equal(odd(3), true));\n',
    );
    // The fixture's lockfile comes from the same declared pnpm the install under test fetches,
    // so the host needs no pnpm of its own (the publish runner carries none).
    await run(
      "npx",
      [
        "--yes",
        "--package",
        "pnpm@9.15.0",
        "pnpm",
        "install",
        "--lockfile-only",
        "--ignore-scripts",
      ],
      { cwd: repo },
    );
    await gitIn(["add", "-A"]);
    await gitIn(["commit", "-qm", "base"]);
    const pnpmBase = (await gitIn(["rev-parse", "HEAD"])).stdout.trim();
    await writeFile(
      join(repo, "odd.mjs"),
      'import isOdd from "is-odd";\nexport const odd = (n) => Boolean(isOdd(n));\n',
    );
    await gitIn(["commit", "-qam", "change"]);
    const pnpmHead = (await gitIn(["rev-parse", "HEAD"])).stdout.trim();
    const ran = await run(
      process.execPath,
      [
        resolve("src/swarm-verify.ts"),
        "ci",
        "--workspace",
        repo,
        "--branch",
        pnpmHead,
        "--base",
        pnpmBase,
        "--isolation",
        "docker:node:24-bookworm",
        "--require-isolation",
        "--install",
        "--json",
      ],
      {
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NO_COLOR: "1" },
        timeout: 600_000,
        maxBuffer: 16_000_000,
      },
    ).catch((cause: { stdout?: string; stderr?: string; code?: number }) => ({
      stdout: cause.stdout ?? "",
      stderr: cause.stderr ?? "",
      code: cause.code,
    }));
    const report = JSON.parse(
      ran.stdout
        .trim()
        .split("\n")
        .findLast((line) => line.startsWith("{")) ?? "{}",
    ) as {
      regression: string;
      install: { succeeded: boolean; command: string; detail: string } | null;
    };
    expect(report.install?.succeeded, `${ran.stdout}\n${"stderr" in ran ? ran.stderr : ""}`).toBe(
      true,
    );
    expect(report.install?.command).toBe(
      "npx --yes --package pnpm@9.15.0 pnpm install --frozen-lockfile --ignore-scripts",
    );
    expect(report.regression).toBe("pass");
  }, 600_000);
});

describe.skipIf(!docker)("an authorized install inside the container", () => {
  it("reaches the registry for the lockfile install only, then checks with the network off", async () => {
    const ran = await run(
      process.execPath,
      [
        resolve("src/swarm-verify.ts"),
        "ci",
        "--workspace",
        workspace,
        "--branch",
        head,
        "--base",
        base,
        "--isolation",
        "docker:node:24-bookworm",
        "--require-isolation",
        "--install",
        "--json",
      ],
      {
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NO_COLOR: "1" },
        timeout: 600_000,
        maxBuffer: 16_000_000,
      },
    ).catch((cause: { stdout?: string; stderr?: string; code?: number }) => ({
      stdout: cause.stdout ?? "",
      stderr: cause.stderr ?? "",
      code: cause.code,
    }));
    const report = JSON.parse(
      ran.stdout
        .trim()
        .split("\n")
        .findLast((line) => line.startsWith("{")) ?? "{}",
    ) as {
      regression: string;
      executionTrust: string;
      install: { succeeded: boolean; detail: string } | null;
      bundleDirectory: string;
    };
    expect(report.install?.succeeded, `${ran.stdout}\n${"stderr" in ran ? ran.stderr : ""}`).toBe(
      true,
    );
    expect(report.regression).toBe("pass");
    expect(report.executionTrust).toBe("isolated");
    const ledger = await readFile(join(report.bundleDirectory, "ledger.jsonl"), "utf8");
    const installRecord = ledger.split("\n").find((line) => line.includes('"dependency-install"'));
    expect(installRecord).toBeDefined();
    const payloads = await readFile(
      join(
        report.bundleDirectory,
        "blobs",
        `${JSON.parse(installRecord as string).payloadDigest.replace("sha256:", "")}.json`,
      ),
      "utf8",
    );
    expect(JSON.parse(payloads)).toMatchObject({
      network: "registry",
      argv: ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
    });
  }, 600_000);
});
