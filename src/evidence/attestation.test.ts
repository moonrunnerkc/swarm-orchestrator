import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  attestationPredicateType,
  buildAttestation,
  signAttestation,
  verifyAttestation,
} from "./attestation.ts";
import { keyFingerprint } from "./signer-trust.ts";
import { signingKeyFromPkcs8 } from "./signing.ts";

function namedKey() {
  const pair = generateKeyPairSync("ed25519");
  return signingKeyFromPkcs8(
    pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    "keychain",
  );
}

const subject = {
  runId: "r1",
  specDigest: `sha256:${"11".repeat(32)}`,
  sourceCommit: "a".repeat(40),
  patchDigest: `sha256:${"22".repeat(32)}`,
  chainHead: `sha256:${"33".repeat(32)}`,
  toolVersion: "13.1.9",
  executionMode: "restricted",
  verdict: { acceptable: false, behavioral: "unmeasured" },
};

describe("an attestation over what a run produced", () => {
  it("binds every authoritative input under one signature", () => {
    const statement = buildAttestation(subject);

    expect(statement.predicateType).toBe(attestationPredicateType);
    expect(statement.subject[0]?.digest.sha256).toBe(subject.patchDigest.slice("sha256:".length));
    expect(statement.predicate.specDigest).toBe(subject.specDigest);
    expect(statement.predicate.chainHead).toBe(subject.chainHead);
  });

  it("verifies against the key that signed it", () => {
    const key = namedKey();
    const envelope = signAttestation(buildAttestation(subject), key);

    expect(
      verifyAttestation(envelope, {
        mode: "expected-signers",
        signers: [keyFingerprint(key.publicKeySpki)],
      }).signer,
    ).toBe("trusted");
  });

  it("refuses an envelope whose payload was changed after signing", () => {
    const key = namedKey();
    const envelope = signAttestation(buildAttestation(subject), key);
    const tampered = {
      ...envelope,
      payload: Buffer.from(
        JSON.stringify(buildAttestation({ ...subject, sourceCommit: "b".repeat(40) })),
      ).toString("base64"),
    };

    expect(verifyAttestation(tampered, { mode: "any-key" }).integrity).toBe("invalid");
  });

  it("refuses an envelope re-signed by a key the policy does not name", () => {
    const author = namedKey();
    const attacker = namedKey();
    const envelope = signAttestation(buildAttestation(subject), author);
    const resigned = signAttestation(buildAttestation(subject), attacker);

    const judged = verifyAttestation(resigned, {
      mode: "expected-signers",
      signers: [keyFingerprint(author.publicKeySpki)],
    });

    expect(judged.integrity).toBe("valid");
    expect(judged.signer).toBe("untrusted");
    expect(envelope.signatures[0]?.sig).not.toBe(resigned.signatures[0]?.sig);
  });

  it("signs over the payload type as well as the payload, so a type swap does not verify", () => {
    // DSSE's pre-authentication encoding exists for this: a signature over the bytes alone
    // would still verify if the payload were reinterpreted as a different kind of document.
    const key = namedKey();
    const envelope = signAttestation(buildAttestation(subject), key);
    const swapped = { ...envelope, payloadType: "application/vnd.something-else" };

    expect(verifyAttestation(swapped, { mode: "any-key" }).integrity).toBe("invalid");
  });

  it("carries no signature it cannot check", () => {
    const envelope = signAttestation(buildAttestation(subject), namedKey());

    expect(envelope.signatures).toHaveLength(1);
    expect(envelope.signatures[0]?.keyid).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

it("verifies against independently assembled DSSE signing bytes", async () => {
  const { createPublicKey, verify } = await import("node:crypto");
  const key = namedKey();
  const envelope = signAttestation(buildAttestation(subject), key);
  const body = Buffer.from(envelope.payload, "base64");
  const type = Buffer.from(envelope.payloadType, "utf8");
  const bytes = Buffer.concat([
    Buffer.from(`DSSEv1 ${type.length} `),
    type,
    Buffer.from(` ${body.length} `),
    body,
  ]);
  expect(
    verify(
      null,
      bytes,
      createPublicKey({
        key: Buffer.from(key.publicKeySpki, "base64"),
        type: "spki",
        format: "der",
      }),
      Buffer.from(envelope.signatures[0]?.sig ?? "", "base64"),
    ),
  ).toBe(true);
});

it("treats malformed signed statements as invalid", () => {
  const key = namedKey();
  const envelope = signAttestation({ ...buildAttestation(subject), _type: "wrong" } as never, key);
  expect(verifyAttestation(envelope, { mode: "any-key" }).integrity).toBe("invalid");
});

it("keeps legacy base64 signing behind an explicit v3 compatibility path", () => {
  const key = namedKey();
  const statement = {
    ...buildAttestation(subject),
    predicateType: "https://swarm-orchestrator.dev/attestation/v3",
  };
  const payload = Buffer.from(JSON.stringify(statement));
  const type = "application/vnd.in-toto+json";
  const pae = Buffer.concat([
    Buffer.from(`DSSEv1 ${Buffer.byteLength(type)} ${type} ${payload.length} `),
    payload,
  ]);
  const envelope = {
    payloadType: type,
    payload: payload.toString("base64"),
    signatures: [
      {
        keyid: keyFingerprint(key.publicKeySpki),
        publicKey: key.publicKeySpki,
        sig: key.sign(pae.toString("base64")),
        keySource: key.source,
      },
    ],
  };
  expect(verifyAttestation(envelope, { mode: "any-key" })).toMatchObject({ integrity: "valid" });
});
