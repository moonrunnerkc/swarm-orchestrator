import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportBundle } from "./bundle.ts";
import { openEvidenceSession } from "./session.ts";
import { judgeSigner, keyFingerprint } from "./signer-trust.ts";
import { signingKeyFromPkcs8 } from "./signing.ts";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-resign-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function namedKey() {
  const pair = generateKeyPairSync("ed25519");
  return signingKeyFromPkcs8(
    pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    "keychain",
  );
}

const clock = { now: () => 0, sleep: () => Promise.resolve() };

describe("a bundle somebody rewrote and signed again with a key of their own", () => {
  it("is refused against the signer the reader expected, however well it verifies", async () => {
    const author = namedKey();
    const evidence = await openEvidenceSession({
      root: join(root, "sessions"),
      sessionId: "resign",
      clock,
    });
    await evidence.record({
      type: "session-started",
      actor: "harness",
      provenance: ["user"],
      payload: { task: "the work that was actually done" },
    });

    const destination = join(root, "bundle");
    await exportBundle({
      source: {
        sessionId: "resign",
        records: evidence.records(),
        blobBytes: (digest) => evidence.blobs.bytes(digest),
      },
      destination,
      clock,
      signingKey: author,
    });

    // The attack: take the bundle, sign its chain head with a key of your own, and ship that
    // key in the manifest beside the signature. Nothing inside the bundle can tell.
    const manifestPath = join(destination, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const attacker = namedKey();
    manifest.signature = {
      algorithm: "ed25519",
      publicKey: attacker.publicKeySpki,
      value: attacker.sign(manifest.chainHead),
      keySource: "keychain",
    };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    const rewritten = JSON.parse(await readFile(manifestPath, "utf8"));

    // Consistency still holds: the signature verifies against the key that came with it.
    expect(judgeSigner(rewritten.chainHead, rewritten.signature, { mode: "any-key" }).signer).toBe(
      "untrusted",
    );

    // Authenticity does not. This is the check the bundle cannot make about itself.
    const verdict = judgeSigner(rewritten.chainHead, rewritten.signature, {
      mode: "expected-signers",
      signers: [keyFingerprint(author.publicKeySpki)],
    });

    expect(verdict.signer).toBe("untrusted");
    expect(verdict.reason).toContain(keyFingerprint(attacker.publicKeySpki));
  });

  it("accepts the same bundle against the signer that actually made it", async () => {
    const author = namedKey();
    const evidence = await openEvidenceSession({
      root: join(root, "sessions"),
      sessionId: "honest",
      clock,
    });
    await evidence.record({
      type: "session-started",
      actor: "harness",
      provenance: ["user"],
      payload: { task: "the work that was actually done" },
    });

    const destination = join(root, "honest-bundle");
    await exportBundle({
      source: {
        sessionId: "honest",
        records: evidence.records(),
        blobBytes: (digest) => evidence.blobs.bytes(digest),
      },
      destination,
      clock,
      signingKey: author,
    });

    const manifest = JSON.parse(await readFile(join(destination, "manifest.json"), "utf8"));

    expect(
      judgeSigner(manifest.chainHead, manifest.signature, {
        mode: "expected-signers",
        signers: [keyFingerprint(author.publicKeySpki)],
      }).signer,
    ).toBe("trusted");
  });
});
