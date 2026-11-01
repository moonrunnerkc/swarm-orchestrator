import { execFileSync, spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
  return started(endpoint, extra).done;
}

function started(endpoint: string, extra: readonly string[] = []) {
  const args = [cli, "run", "Make half(n) return n / 2."];
  // The host, said by name: these tests are about the loop and its endpoint, not isolation.
  args.push("--endpoint", endpoint, "--model", "stub", "--approve", "auto", "--host", ...extra);
  const child = spawn(process.execPath, args, {
    cwd: repo,
    env: { ...process.env, SWARM_HOME: join(root, "home"), SWARM_SIGNING_KEY: signingKey },
  });
  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.resume();
  const done = new Promise<{ code: number | null; stdout: string }>((settle) =>
    child.on("close", (code) => settle({ code, stdout })),
  );
  return { child, done };
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
    // The fix was already in the working tree when the run began: part of its starting state, so
    // the run itself changed nothing and R1 is unverified.
    expect(ran.code).toBe(4);
    expect(ran.stdout).toMatch(/^stop {9}model-error: the model endpoint failed: HTTP 404/m);
    expect(ran.stdout).toMatch(/^state {8}incomplete$/m);
    expect(ran.stdout).toMatch(/^R1 {11}unverified {3}no change observed/m);
    expect(ran.stdout).toMatch(/^regression {3}none$/m);
  });

  it("stops on a refused connection the same way", async () => {
    const stub = await startStubModel();
    await stub.close();
    const ran = await swarmRun(`http://127.0.0.1:${stub.port}/v1`);
    expect(ran.code).toBe(4);
    expect(ran.stdout).toMatch(
      /^stop {9}model-error: the model endpoint failed: connection refused at/m,
    );
    expect(ran.stdout).toMatch(/^regression {3}none$/m);
  });

  it("finalizes a run stopped by SIGTERM or SIGHUP as cancelled and removes its worktree", async () => {
    for (const signal of ["SIGTERM", "SIGHUP"] as const) {
      const stub = await startStubModel();
      const run = started(`http://127.0.0.1:${stub.port}/v1`);
      while (stub.requests.length === 0) await new Promise((wait) => setTimeout(wait, 50));
      run.child.kill(signal);
      const ran = await run.done;
      await stub.close();
      expect(ran.stdout).toContain(`\nstop         cancelled: stopped by ${signal}\n`);
      expect(ran.code).toBe(4);
      expect((await readdir(root)).filter((name) => name.includes(".swarm-"))).toEqual([]);
    }
  });

  it("passes the user's authorization to change tested behavior to the verifier and the report", async () => {
    const stub = await startStubModel();
    const ran = await swarmRun(`http://127.0.0.1:${stub.port}/v1`, [
      "--max-steps",
      "1",
      "--authorize-behavior-change",
    ]);
    await stub.close();
    const report = ran.stdout.match(/^report {7}(.+)$/m)?.[1] ?? "";
    expect(await readFile(report, "utf8")).toContain(
      "The user authorized a change of tested behavior (--authorize-behavior-change); expectations it superseded: none.",
    );
  });

  it("lets the step budget, not a fixed token count, end a run where no token budget is set", async () => {
    // 60 turns that each add some 4,000 tokens pass 1,000,000 prompt tokens in all, and every one
    // of them fits a budget of steps times context.
    const stub = await startStubModel({
      replies: Array.from(
        { length: 60 },
        (_, at) => `\`\`\`bash\necho ${at} ${"x".repeat(8000)}\n\`\`\``,
      ),
    });
    const ran = await swarmRun(`http://127.0.0.1:${stub.port}/v1`, [
      "--max-steps",
      "60",
      "--context",
      "100000",
    ]);
    await stub.close();
    expect(ran.stdout).toContain("stop         step-budget");
  });

  it("verifies with the installed dependencies when asked, where the lockfile does not install", async () => {
    // The manifest asks for a package the lockfile does not hold, so npm ci refuses.
    await writeFile(
      join(repo, "package.json"),
      '{"name":"f","version":"1.0.0","type":"module","dependencies":{"left-pad":"1.3.0"}}\n',
    );
    await writeFile(
      join(repo, "package-lock.json"),
      '{"name":"f","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"f","version":"1.0.0"}}}\n',
    );
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "lockfile"], { cwd: repo });
    const stub = await startStubModel();
    const endpoint = `http://127.0.0.1:${stub.port}/v1`;
    const prepared = await swarmRun(endpoint, ["--max-steps", "1"]);
    expect(prepared.stdout).toMatch(/^state {8}blocked$/m);
    expect(prepared.stdout).toMatch(/^blocked {6}the base's dependencies did not install/m);
    const linked = await swarmRun(endpoint, ["--max-steps", "1", "--linked-dependencies"]);
    await stub.close();
    expect(linked.stdout).toMatch(/^stop {9}step-budget$/m);
    expect(linked.stdout).toMatch(/^execution {4}host, not isolated/m);
  });

  it("refuses linked dependencies in a container, which the verifier would refuse", async () => {
    const ran = spawnSync(
      process.execPath,
      [
        cli,
        "run",
        "task",
        "--linked-dependencies",
        "--endpoint",
        "http://127.0.0.1:9/v1",
        "--model",
        "m",
      ],
      { cwd: repo, encoding: "utf8", env: { ...process.env, SWARM_HOME: join(root, "home") } },
    );
    expect(ran.stderr).toContain("--linked-dependencies needs --host");
    expect(ran.status).not.toBe(0);
  });

  it("records a finished run in the model's record on this machine", async () => {
    const stub = await startStubModel();
    const endpoint = `http://127.0.0.1:${stub.port}/v1`;
    await swarmRun(endpoint, ["--max-steps", "1"]);
    await stub.close();
    const profiles = join(root, "home", "profiles");
    const [file] = await readdir(profiles);
    const profile = JSON.parse(await readFile(join(profiles, file ?? ""), "utf8"));
    expect(profile.outcomes[`${endpoint}#stub`]).toEqual({ complete: 0, other: 1 });
  });
});
