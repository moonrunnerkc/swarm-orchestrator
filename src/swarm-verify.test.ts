import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const run = promisify(execFile);

/**
 * `swarm-verify` is the verification path of `swarm` shipped on its own. The proof that nothing
 * changed on the way out is the output itself: the same committed bundle checked through both
 * entry points has to produce the same bytes and the same exit code, with and without an
 * expected signer.
 */
const committedBundle = resolve("docs/evidence/2026-09-02/gates-bonded");

let scratch = "";
let workspace = "";
let signer = "";

interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function invoke(entry: "cli" | "swarm-verify", args: readonly string[]): Promise<Ran> {
  const environment = {
    PATH: process.env.PATH ?? "",
    HOME: join(scratch, "home"),
    NO_COLOR: "1",
    SWARM_LOCAL_BASE_URL: "http://127.0.0.1:9",
  };
  try {
    const ran = await run(process.execPath, [resolve(`src/${entry}.ts`), ...args], {
      env: environment,
      timeout: 60_000,
      maxBuffer: 8_000_000,
    });
    return { code: 0, stdout: ran.stdout, stderr: ran.stderr };
  } catch (cause) {
    const failed = cause as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
  }
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-verify-"));
  const manifest = JSON.parse(await readFile(join(committedBundle, "manifest.json"), "utf8")) as {
    signature: { fingerprint?: string; publicKey?: string };
  };
  const { keyFingerprint } = await import("./evidence/signer-trust.ts");
  signer = keyFingerprint(manifest.signature.publicKey ?? "");
  workspace = join(scratch, "workspace");
  await run("git", ["init", "-q", workspace]);
  await writeFile(
    join(workspace, "package.json"),
    '{ "name": "w", "version": "1.0.0", "type": "module", "scripts": { "test": "node --test" } }\n',
  );
  await writeFile(join(workspace, "half.mjs"), "export const half = (n) => n / 2;\n");
  await writeFile(
    join(workspace, "half.test.mjs"),
    'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { half } from "./half.mjs";\ntest("halves", () => assert.equal(half(4), 2));\n',
  );
  await run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "add", "-A"], {
    cwd: workspace,
  });
  await run(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "base"],
    { cwd: workspace },
  );
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("swarm-verify beside swarm", () => {
  it("verifies a committed bundle byte for byte the same, with the signer named", async () => {
    const through = await invoke("cli", ["verify", committedBundle, "--signer", signer]);
    const standalone = await invoke("swarm-verify", [
      "verify",
      committedBundle,
      "--signer",
      signer,
    ]);

    expect(through.stdout).toContain("integrity:  valid");
    expect(standalone).toEqual(through);
    expect(standalone.code).toBe(0);
  });

  it("verifies it byte for byte the same with no signer named, exit code included", async () => {
    const through = await invoke("cli", ["verify", committedBundle]);
    const standalone = await invoke("swarm-verify", ["verify", committedBundle]);

    expect(through.stdout).toContain("signer:     untrusted");
    expect(standalone).toEqual(through);
    expect(standalone.code).toBe(1);
  });

  it("refuses a bundle one byte later, the same way", async () => {
    // The demo's own subject, since the script flips one named record of that bundle.
    const demoBundle = resolve("docs/evidence/2026-08-18/live-frontier");
    const demoSigner = "sha256:db270183c40c65843cacd2b3dcf20ee249d146d98c56699b2f3512ebeb84a52a";
    const tampered = join(scratch, "tampered");
    await run(process.execPath, [
      resolve("docs/evidence/2026-08-18/tamper-demo/flip-one-byte.mjs"),
      demoBundle,
      tampered,
    ]);

    const through = await invoke("cli", ["verify", tampered, "--signer", demoSigner]);
    const standalone = await invoke("swarm-verify", ["verify", tampered, "--signer", demoSigner]);

    expect(standalone.stdout).toContain("integrity:  invalid");
    expect(standalone).toEqual(through);
    expect(standalone.code).toBe(1);
  });

  it("measures a workspace the same way, apart from the session it wrote", async () => {
    const through = await invoke("cli", ["gates", "--workspace", workspace]);
    const standalone = await invoke("swarm-verify", ["gates", "--workspace", workspace]);

    const settled = (ran: Ran) =>
      ran.stdout
        .split("\n")
        .filter((line) => !line.includes(join(scratch, "home")))
        .join("\n");
    expect(through.stdout).toContain("acceptable: yes");
    expect(settled(standalone)).toBe(settled(through));
    expect(standalone.code).toBe(through.code);
  });

  it("prints its own usage for no command and for --help", async () => {
    const bare = await invoke("swarm-verify", []);
    const help = await invoke("swarm-verify", ["--help"]);

    expect(bare.code).toBe(0);
    expect(bare.stdout).toContain("swarm-verify verify <bundle directory>");
    expect(bare.stdout).toContain("swarm-verify ci --patch <file>");
    expect(bare.stdout).toContain("swarm-verify gates");
    expect(help.stdout).toBe(bare.stdout);
  });

  it("refuses a command the full CLI has and this binary does not, naming its own usage", async () => {
    const ran = await invoke("swarm-verify", ["parallel", "--goal", "x"]);

    expect(ran.code).toBe(1);
    expect(ran.stderr).toContain('"parallel" is not a command this binary has');
    expect(ran.stderr).toContain("swarm-verify verify");
  });

  it("refuses a malformed line with the full CLI's exit code and the same problem named", async () => {
    const through = await invoke("cli", ["ci"]);
    const standalone = await invoke("swarm-verify", ["ci"]);

    expect(standalone.code).toBe(through.code);
    expect(through.stderr).toContain("ci needs --patch <file>");
    expect(standalone.stderr).toContain("ci needs --patch <file>");
  });
});
