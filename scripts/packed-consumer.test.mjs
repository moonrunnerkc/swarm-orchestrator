import { execFileSync, spawn } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startStubModel } from "../eval/stub-model.mjs";

/**
 * The agent as a user installs it: this checkout packed, beside the exact verifier tarball the
 * lockfile pins, installed into a fresh prefix, then one task run through the installed `swarm`
 * so the verification goes through the installed swarm-verify's public API and nothing else.
 */
const root = join(import.meta.dirname, "..");
const completionMarker = "SWARM_TASK_COMPLETE";
const signingKey = generateKeyPairSync("ed25519")
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();

let scratch = "";

/** The tarball with this integrity, read from npm's content-addressed cache and checked. */
async function cachedTarball(integrity) {
  const cache = execFileSync("npm", ["config", "get", "cache"], { encoding: "utf8" }).trim();
  const digest = Buffer.from(integrity.replace(/^sha512-/, ""), "base64").toString("hex");
  const path = join(
    cache,
    "_cacache",
    "content-v2",
    "sha512",
    digest.slice(0, 2),
    digest.slice(2, 4),
    digest.slice(4),
  );
  const bytes = await readFile(path).catch(() => {
    throw new Error(`the verifier tarball ${integrity} is not in the npm cache; run npm ci first`);
  });
  expect(`sha512-${createHash("sha512").update(bytes).digest("base64")}`).toBe(integrity);
  return bytes;
}

beforeAll(async () => {
  // Resolution answers with real paths, and macOS temporary directories sit behind a symlink.
  scratch = await realpath(await mkdtemp(join(tmpdir(), "packed-consumer-")));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("the packed agent against the packed verifier", () => {
  it("runs a task through the installed swarm and the installed swarm-verify", async () => {
    const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    const pinned = lock.packages["node_modules/swarm-verify"];
    // An exact version, not a range: the agent ships against the verifier it was tested with.
    expect(manifest.dependencies["swarm-verify"]).toBe(pinned.version);

    const packs = join(scratch, "packs");
    await mkdir(packs);
    const verifierTarball = join(packs, `swarm-verify-${pinned.version}.tgz`);
    await writeFile(verifierTarball, await cachedTarball(pinned.integrity));
    execFileSync("npm", ["pack", "--silent", "--pack-destination", packs], { cwd: root });
    const agentTarball = join(packs, `swarm-orchestrator-${manifest.version}.tgz`);

    const prefix = join(scratch, "prefix");
    await mkdir(prefix);
    await writeFile(join(prefix, "package.json"), '{ "name": "consumer", "private": true }\n');
    execFileSync(
      "npm",
      ["install", "--no-audit", "--no-fund", "--prefer-offline", verifierTarball, agentTarball],
      { cwd: prefix, stdio: "ignore" },
    );
    const installedAgent = join(prefix, "node_modules", "swarm-orchestrator");
    const resolved = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", 'process.stdout.write(import.meta.resolve("swarm-verify"))'],
      { cwd: installedAgent, encoding: "utf8" },
    );
    expect(
      resolved.startsWith(pathToFileURL(join(prefix, "node_modules", "swarm-verify")).href),
    ).toBe(true);

    const repo = join(scratch, "repo");
    await mkdir(join(repo, "test"), { recursive: true });
    const git = (...args) => execFileSync("git", args, { cwd: repo });
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
    await writeFile(join(repo, "half.mjs"), "export const half = (n) => n / 2;\n");

    const record = [{ id: "R1", text: "x", kind: "fix", evidence: { tests: [{ name: "half" }] } }];
    const reply = `\`\`\`requirements\n${JSON.stringify(record)}\n\`\`\`\n${completionMarker}`;
    const stub = await startStubModel({ replies: [reply] });
    const swarm = join(prefix, "node_modules", ".bin", "swarm");
    const child = spawn(
      swarm,
      [
        "run",
        "Make half(n) return n / 2.",
        "--endpoint",
        `http://127.0.0.1:${stub.port}/v1`,
        "--model",
        "stub",
        "--approve",
        "auto",
      ],
      {
        cwd: repo,
        env: { ...process.env, SWARM_HOME: join(scratch, "home"), SWARM_SIGNING_KEY: signingKey },
      },
    );
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.resume();
    const code = await new Promise((settle) => child.on("close", settle));
    await stub.close();
    expect(stdout).toMatch(/^stop {9}complete$/m);
    expect(stdout).toMatch(/^state {8}complete$/m);
    expect(stdout).toMatch(/^R1 {11}satisfied/m);
    expect(code).toBe(0);
    const attestation = /^attestation {2}(.+)$/m.exec(stdout)?.[1] ?? "";
    const statement = JSON.parse(await readFile(join(attestation, "..", "statement.json"), "utf8"));
    expect(statement.predicate.verifier).toEqual({ name: "swarm-verify", version: pinned.version });
    expect(statement.predicate.producer.name).toBe("swarm-orchestrator");
  }, 300_000);
});
