import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  type CommandRunner,
  createEphemeralSigningKey,
  createKeychainSecretStore,
  resolveSigningKey,
  signChainHead,
  signingKeyFromPkcs8,
  verifyChainHeadSignature,
} from "./signing.ts";

const chainHead = `sha256:${"c".repeat(64)}`;

interface RunnerCall {
  readonly file: string;
  readonly args: readonly string[];
  readonly input: string | undefined;
}

function createRunner(
  responses: (call: RunnerCall) => { stdout?: string; stderr?: string; code?: number },
): { run: CommandRunner; calls: RunnerCall[] } {
  const calls: RunnerCall[] = [];
  const run: CommandRunner = (file, args, input) => {
    const call = { file, args, input };
    calls.push(call);
    const response = responses(call);
    return Promise.resolve({
      stdout: response.stdout ?? "",
      stderr: response.stderr ?? "",
      code: response.code ?? 0,
    });
  };
  return { run, calls };
}

describe("chain head signatures", () => {
  it("signs the head and verifies it back", () => {
    const signature = signChainHead(chainHead, createEphemeralSigningKey());

    expect(signature.algorithm).toBe("ed25519");
    expect(verifyChainHeadSignature(chainHead, signature)).toBe(true);
  });

  it("fails for any other head, which is what makes it tamper-evidence", () => {
    const signature = signChainHead(chainHead, createEphemeralSigningKey());

    expect(verifyChainHeadSignature(`sha256:${"d".repeat(64)}`, signature)).toBe(false);
  });

  it("fails when the signature or the key is swapped", () => {
    const signature = signChainHead(chainHead, createEphemeralSigningKey());
    const other = signChainHead(chainHead, createEphemeralSigningKey());

    expect(verifyChainHeadSignature(chainHead, { ...signature, value: other.value })).toBe(false);
    expect(verifyChainHeadSignature(chainHead, { ...signature, publicKey: other.publicKey })).toBe(
      false,
    );
    expect(verifyChainHeadSignature(chainHead, { ...signature, publicKey: "not-a-key" })).toBe(
      false,
    );
  });

  it("produces the same public key from the same stored private key", () => {
    const pkcs8 = generateKeyPairSync("ed25519")
      .privateKey.export({ type: "pkcs8", format: "der" })
      .toString("base64");

    const first = signingKeyFromPkcs8(pkcs8, "keychain");
    const second = signingKeyFromPkcs8(pkcs8, "keychain");

    expect(second.publicKeySpki).toBe(first.publicKeySpki);
    expect(verifyChainHeadSignature(chainHead, signChainHead(chainHead, second))).toBe(true);
  });
});

describe("keychain key storage", () => {
  it("reads an existing macOS keychain item and reuses that key", async () => {
    const stored = generateKeyPairSync("ed25519")
      .privateKey.export({ type: "pkcs8", format: "der" })
      .toString("base64");
    const { run, calls } = createRunner(() => ({ stdout: `${stored}\n` }));

    const resolved = await resolveSigningKey(
      createKeychainSecretStore({ platform: "darwin", run }),
    );

    expect(resolved.notice).toBeNull();
    expect(resolved.key.source).toBe("keychain");
    expect(resolved.key.publicKeySpki).toBe(signingKeyFromPkcs8(stored, "keychain").publicKeySpki);
    expect(calls[0]?.args).toEqual([
      "find-generic-password",
      "-a",
      "bundle-signing-key",
      "-s",
      "swarm-orchestrator",
      "-w",
    ]);
  });

  it("creates a key on first use and hands the secret over stdin, never argv", async () => {
    const { run, calls } = createRunner((call) =>
      call.args[0] === "find-generic-password" ? { code: 44 } : {},
    );

    const resolved = await resolveSigningKey(
      createKeychainSecretStore({ platform: "darwin", run }),
    );

    expect(resolved.key.source).toBe("keychain");
    const save = calls[1];
    expect(save?.args[0]).toBe("add-generic-password");

    // `-w` with no value asks for the data and then asks again to retype it, and reads both
    // from stdin. Sending the key once answered the first ask and gave the second end of
    // input, so `security` printed "password data for new item:" at a person who had nothing
    // to type: this key is generated here and was never theirs to know. Both asks are answered.
    const [first, second, ...rest] = (save?.input ?? "").split("\n");
    expect(first).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(second).toBe(first);
    expect(rest).toEqual([""]);
    expect(save?.args.join(" ")).not.toContain(first ?? "");
  });

  it("uses the Secret Service on Linux", async () => {
    const { run, calls } = createRunner(() => ({ code: 1 }));

    await resolveSigningKey(createKeychainSecretStore({ platform: "linux", run }));

    expect(calls[0]?.file).toBe("secret-tool");
    expect(calls[1]?.args[0]).toBe("store");
  });

  it("falls back to a per-run key where there is no keychain, and says so", async () => {
    const resolved = await resolveSigningKey(createKeychainSecretStore({ platform: "sunos" }));

    expect(resolved.key.source).toBe("ephemeral");
    expect(resolved.notice).toContain("per-run key");
  });

  /**
   * Found on a real machine: the entry under this service and account held a nine-character
   * string, so every run fell back to a per-run key and said only that an ASN.1 decoding
   * routine did not have enough data. The entry is left alone, because overwriting one whose
   * contents nobody recognizes is destroying something to fix a signature.
   */
  it("says what to look at when the keychain holds something that is not a key", async () => {
    const { run, calls } = createRunner(() => ({ stdout: "kyQpFr98!\n" }));

    const resolved = await resolveSigningKey(
      createKeychainSecretStore({ platform: "darwin", run }),
    );

    expect(resolved.key.source).toBe("ephemeral");
    expect(resolved.notice).toContain("swarm-orchestrator/bundle-signing-key");
    expect(resolved.notice).toContain("is not an ed25519 private key");
    expect(resolved.notice).toContain("Delete that entry");
    // Read once and nothing written: the entry is the user's, and this is not the code that
    // decides to replace it.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args[0]).toBe("find-generic-password");
  });

  it("says the storing failed when that is what failed, rather than blaming the read", async () => {
    const { run } = createRunner((call) =>
      call.args[0] === "find-generic-password" ? { code: 44 } : { code: 1, stderr: "locked" },
    );

    const resolved = await resolveSigningKey(
      createKeychainSecretStore({ platform: "darwin", run }),
    );

    expect(resolved.notice).toContain("would not take a new key");
    expect(resolved.notice).toContain("locked");
  });

  it("falls back and explains itself when the keychain refuses", async () => {
    const { run } = createRunner((call) =>
      call.args[0] === "find-generic-password" ? { code: 44 } : { code: 1, stderr: "user denied" },
    );

    const resolved = await resolveSigningKey(
      createKeychainSecretStore({ platform: "darwin", run }),
    );

    expect(resolved.key.source).toBe("ephemeral");
    expect(resolved.notice).toContain("user denied");
    // A bundle still exports; the manifest records that the key does not outlive the run.
    expect(signChainHead(chainHead, resolved.key).keySource).toBe("ephemeral");
  });
});
