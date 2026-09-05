import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { judgeSigner, keyFingerprint, type TrustPolicy } from "./signer-trust.ts";
import { createEphemeralSigningKey, signChainHead, signingKeyFromPkcs8 } from "./signing.ts";

const chainHead = `sha256:${"ab".repeat(32)}`;

function namedKey() {
  const pair = generateKeyPairSync("ed25519");
  const pkcs8 = pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
  return signingKeyFromPkcs8(pkcs8, "keychain");
}

describe("what a bundle signature establishes", () => {
  it("is untrusted where no expected signer was named, however well it verifies", () => {
    // The public key travels inside the bundle it signs. Anyone can edit the bundle, rehash it,
    // sign it with a key of their own, and the signature verifies against the key they shipped.
    // That is consistency. Authenticity needs an identity from outside the bundle.
    const key = namedKey();
    const verdict = judgeSigner(chainHead, signChainHead(chainHead, key), { mode: "any-key" });

    expect(verdict.signer).toBe("untrusted");
    expect(verdict.reason).toMatch(/who made it|no expected signer/i);
  });

  it("refuses a bundle re-signed by a key the policy does not name", () => {
    const attacker = namedKey();
    const policy: TrustPolicy = {
      mode: "expected-signers",
      signers: [keyFingerprint(namedKey().publicKeySpki)],
    };

    const verdict = judgeSigner(chainHead, signChainHead(chainHead, attacker), policy);

    expect(verdict.signer).toBe("untrusted");
    expect(verdict.reason).toContain(keyFingerprint(attacker.publicKeySpki));
  });

  it("accepts the signer the policy named", () => {
    const key = namedKey();
    const policy: TrustPolicy = {
      mode: "expected-signers",
      signers: [keyFingerprint(key.publicKeySpki)],
    };

    expect(judgeSigner(chainHead, signChainHead(chainHead, key), policy).signer).toBe("trusted");
  });

  it("calls a signature that does not verify invalid, which is not the same as untrusted", () => {
    const key = namedKey();
    const signature = signChainHead(chainHead, key);
    const policy: TrustPolicy = {
      mode: "expected-signers",
      signers: [keyFingerprint(key.publicKeySpki)],
    };

    const verdict = judgeSigner(`sha256:${"cd".repeat(32)}`, signature, policy);

    expect(verdict.signer).toBe("invalid");
  });

  it("never trusts an ephemeral key, because it was made by the run it vouches for", () => {
    const key = createEphemeralSigningKey();
    const policy: TrustPolicy = {
      mode: "expected-signers",
      signers: [keyFingerprint(key.publicKeySpki)],
    };

    const verdict = judgeSigner(chainHead, signChainHead(chainHead, key), policy);

    expect(verdict.signer).toBe("untrusted");
    expect(verdict.reason).toMatch(/ephemeral/i);
  });

  it("fingerprints a key the same way every time and differently per key", () => {
    const key = namedKey();

    expect(keyFingerprint(key.publicKeySpki)).toBe(keyFingerprint(key.publicKeySpki));
    expect(keyFingerprint(key.publicKeySpki)).not.toBe(keyFingerprint(namedKey().publicKeySpki));
    expect(keyFingerprint(key.publicKeySpki)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
