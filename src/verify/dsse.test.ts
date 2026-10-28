import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bundleOf, envelopeOf, envelopeVerifies, pae, signStatement } from "./dsse.ts";
import { keyFromText } from "./signing.ts";

const pem = generateKeyPairSync("ed25519")
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
const key = keyFromText(pem, "environment");
const statement = { _type: "https://in-toto.io/Statement/v1", subject: [], predicate: {} };

describe("DSSE envelopes", () => {
  it("encodes the pre-authentication string as the specification spells it", () => {
    expect(pae("t", Buffer.from("ab")).toString()).toBe("DSSEv1 1 t 2 ab");
  });

  it("verifies a signed statement against the signer's public key", () => {
    const envelope = signStatement(statement, key);
    expect(envelopeVerifies(envelope, key.publicKeyPem)).toBe(true);
    expect(JSON.parse(Buffer.from(envelope.payload, "base64").toString())).toEqual(statement);
  });

  it("refuses the envelope after one byte of its payload changes", () => {
    const envelope = signStatement(statement, key);
    const bytes = Buffer.from(envelope.payload, "base64");
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    expect(
      envelopeVerifies({ ...envelope, payload: bytes.toString("base64") }, key.publicKeyPem),
    ).toBe(false);
  });

  it("refuses it under another key", () => {
    const other = keyFromText(
      generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      "environment",
    );
    expect(envelopeVerifies(signStatement(statement, key), other.publicKeyPem)).toBe(false);
  });

  it("reads the envelope out of a bundle or on its own", () => {
    const envelope = signStatement(statement, key);
    expect(envelopeOf(bundleOf(envelope, key))).toEqual(envelope);
    expect(envelopeOf(envelope)).toEqual(envelope);
    expect(envelopeOf({ payload: "x" })).toBeNull();
  });
});
