import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const cli = resolve(import.meta.dirname, "cli.ts");
const verifier = resolve(import.meta.dirname, "..", "packages", "swarm-verify", "verify.mjs");
const signingKey = generateKeyPairSync("ed25519")
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();

let root = "";
let repo = "";
let out = "";

const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
const node = (args: string[], cwd = repo) =>
  spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, SWARM_SIGNING_KEY: signingKey, SWARM_HOME: join(root, "home") },
  });

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "cli-verify-"));
  repo = join(root, "repo");
  out = join(root, "out");
  await mkdir(join(repo, "test"), { recursive: true });
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
  git("checkout", "-qb", "fix");
  await writeFile(join(repo, "half.mjs"), "export const half = (n) => n / 2;\n");
  git("commit", "-qam", "fix");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("swarm verify and verify.mjs", () => {
  it("verifies a ref range, signs it, and the dependency-free script agrees", async () => {
    const ran = node([cli, "verify", "--range", "main..fix", "--out", out]);
    expect(ran.stdout).toMatch(/^verdict\s+pass$/m);
    expect(ran.status).toBe(0);

    const tree = join(root, "tree");
    await mkdir(tree);
    execFileSync("sh", ["-c", `git archive fix | tar -x -C ${tree}`], { cwd: repo });
    const checked = node([
      verifier,
      join(out, "attestation.sigstore.json"),
      "--key",
      join(out, "attestation.pub.pem"),
      "--patch",
      join(out, "change.patch"),
      "--tree",
      tree,
    ]);
    expect(checked.stdout).toContain("ok     signature");
    expect(checked.stdout).toContain("ok     tree");
    expect(checked.status).toBe(0);
  });

  it("fails verify.mjs after one byte of the attestation changes", async () => {
    const path = join(out, "attestation.sigstore.json");
    const bytes = await readFile(path);
    const at = bytes.indexOf('"payload": "') + 30;
    bytes[at] = bytes[at] === 0x41 ? 0x42 : 0x41;
    await writeFile(join(root, "tampered.json"), bytes);
    const checked = node([
      verifier,
      join(root, "tampered.json"),
      "--key",
      join(out, "attestation.pub.pem"),
    ]);
    expect(checked.stdout).toContain("FAILED signature");
    expect(checked.status).toBe(1);
  });

  it("exits 1 for a failing change and 2 for a command line it cannot read", () => {
    expect(node([cli, "verify", "--range", "fix..main", "--out", join(root, "out-2")]).status).toBe(
      1,
    );
    const unread = node([cli, "verify", "--patch", "a", "--range", "b..c"]);
    expect(unread.status).toBe(2);
    expect(unread.stderr).toContain("not both");
  });

  it("lists exactly the commands it has", () => {
    const help = node([cli, "--help"]).stdout;
    const listed = [...help.matchAll(/^ {2}swarm (\S+)/gm)].map((match) => match[1]);
    expect(listed).toEqual(["run", "verify", "init", "ci", "doctor"]);
  });
});
