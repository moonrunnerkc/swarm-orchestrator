import { describe, expect, it } from "vitest";
import { parseCommandLine } from "./cli-options.ts";

const context = { currentDirectory: "/repo", environment: {} };

describe("swarm verify", () => {
  it("takes a bundle directory", () => {
    const parsed = parseCommandLine(["verify", "./out"], context);

    expect(parsed).toMatchObject({ command: "verify", bundleDirectory: "/repo/out" });
  });

  it("takes the signers a reader expects, from outside the bundle", () => {
    const fingerprint = `sha256:${"ab".repeat(32)}`;
    const parsed = parseCommandLine(["verify", "./out", "--signer", fingerprint], context);

    expect(parsed).toMatchObject({ command: "verify", expectedSigners: [fingerprint] });
  });

  it("takes more than one, because a team has more than one machine", () => {
    const first = `sha256:${"ab".repeat(32)}`;
    const second = `sha256:${"cd".repeat(32)}`;
    const parsed = parseCommandLine(["verify", "./out", "--signer", `${first},${second}`], context);

    expect(parsed).toMatchObject({ expectedSigners: [first, second] });
  });

  it("refuses a bundle directory it was not given", () => {
    expect(() => parseCommandLine(["verify"], context)).toThrow(/bundle directory/);
  });
});

it("the actual CLI refuses tampered evidence even when the bundle's script returns success", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { mkdtemp, readFile, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");
  const { generateKeyPairSync } = await import("node:crypto");
  const { openEvidenceSession } = await import("./evidence/session.ts");
  const { bundleSourceFromRecorder, exportBundle } = await import("./evidence/bundle.ts");
  const { signingKeyFromPkcs8 } = await import("./evidence/signing.ts");
  const { keyFingerprint } = await import("./evidence/signer-trust.ts");
  const root = await mkdtemp(join(tmpdir(), "swarm-cli-verify-"));
  try {
    const clock = { now: () => 1, sleep: async () => {} };
    const evidence = await openEvidenceSession({ root, sessionId: "one", clock });
    await evidence.record({
      type: "session-started",
      actor: "harness",
      provenance: ["user"],
      payload: { task: "fixture" },
    });
    const pair = generateKeyPairSync("ed25519");
    const key = signingKeyFromPkcs8(
      pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
      "keychain",
    );
    const directory = join(root, "bundle");
    const bundle = await exportBundle({
      source: bundleSourceFromRecorder(evidence),
      destination: directory,
      signingKey: key,
      clock,
    });
    const invoke = async (signer = keyFingerprint(key.publicKeySpki)) => {
      try {
        const ran = await promisify(execFile)(
          process.execPath,
          [resolve("src/cli.ts"), "verify", directory, "--signer", signer],
          { timeout: 10000 },
        );
        return { code: 0, output: ran.stdout };
      } catch (cause) {
        const failed = cause as { code: number; stdout: string };
        return { code: failed.code, output: failed.stdout };
      }
    };
    expect(await invoke()).toMatchObject({
      code: 0,
      output: expect.stringMatching(/integrity:\s+valid/),
    });
    await writeFile(join(directory, "verify.mjs"), "process.exit(0);\n");
    const ledger = join(directory, "ledger.jsonl");
    const original = await readFile(ledger, "utf8");
    await writeFile(ledger, original.replace('"timestamp":1', '"timestamp":2'));
    expect((await invoke()).code).not.toBe(0);
    await writeFile(ledger, original);
    expect((await invoke(`sha256:${"ab".repeat(32)}`)).code).not.toBe(0);
    await rm(join(directory, "blobs", `${bundle.manifest.blobs[0]?.slice(7)}.json`));
    expect((await invoke()).code).not.toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
