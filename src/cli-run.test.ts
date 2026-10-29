import { execFileSync, spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startStubModel } from "../eval/stub-model.mjs";

const cli = resolve(import.meta.dirname, "cli.ts");
const signingKey = generateKeyPairSync("ed25519")
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();

let root = "";
let repo = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cli-run-"));
  repo = join(root, "repo");
  await mkdir(join(repo, "test"), { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  await writeFile(join(repo, "swarm.toml"), '[checks]\ntest = "node --test"\n');
  await writeFile(join(repo, "half.mjs"), "export const half = (n) => n;\n");
  await writeFile(
    join(repo, "test", "half.test.mjs"),
    'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { half } from "../half.mjs";\ntest("half", () => assert.equal(half(4), 2));\n',
  );
  git("add", "-A");
  git("commit", "-qm", "base");
  // The fix is already in the working tree, so a verdict on it can only come from the verifier.
  await writeFile(join(repo, "half.mjs"), "export const half = (n) => n / 2;\n");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** `swarm run` as a child, so the stub endpoint in this process can answer it. */
function swarmRun(endpoint: string, extra: readonly string[] = []) {
  const args = [cli, "run", "Make half(n) return n / 2."];
  args.push("--endpoint", endpoint, "--model", "stub", "--approve", "auto", ...extra);
  const child = spawn(process.execPath, args, {
    cwd: repo,
    env: { ...process.env, SWARM_HOME: join(root, "home"), SWARM_SIGNING_KEY: signingKey },
  });
  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.resume();
  return new Promise<{ code: number | null; stdout: string }>((settle) =>
    child.on("close", (code) => settle({ code, stdout })),
  );
}

describe("swarm run against the stub endpoint", () => {
  it("sends the per-turn cap as max_tokens on every turn", async () => {
    const stub = await startStubModel();
    const ran = await swarmRun(`http://127.0.0.1:${stub.port}/v1`, [
      "--max-steps",
      "2",
      "--turn-tokens",
      "512",
    ]);
    await stub.close();
    expect(ran.stdout).toContain("stop         step-budget");
    expect(stub.requests).toHaveLength(2);
    for (const body of stub.requests) expect(body).toMatchObject({ max_tokens: 512 });
  });

  it("stops on a 4xx that is not rate limiting, then verifies the tree and reports why", async () => {
    const stub = await startStubModel({ status: 404 });
    const ran = await swarmRun(`http://127.0.0.1:${stub.port}/v1`);
    await stub.close();
    expect(stub.requests).toHaveLength(1);
    expect(ran.code).toBe(1);
    expect(ran.stdout).toMatch(/^stop {9}model-error$/m);
    expect(ran.stdout).toMatch(/^reason {7}the model endpoint failed: HTTP 404/m);
    expect(ran.stdout).toMatch(/^verdict {6}pass$/m);
    expect(ran.stdout).toMatch(/^tokens {7}0$/m);
  });

  it("stops on a refused connection the same way", async () => {
    const stub = await startStubModel();
    await stub.close();
    const ran = await swarmRun(`http://127.0.0.1:${stub.port}/v1`);
    expect(ran.code).toBe(1);
    expect(ran.stdout).toMatch(/^reason {7}the model endpoint failed: connection refused at/m);
    expect(ran.stdout).toMatch(/^verdict {6}pass$/m);
  });
});
