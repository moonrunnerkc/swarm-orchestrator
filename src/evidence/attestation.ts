import { createPublicKey, verify as verifyBytes } from "node:crypto";
import { z } from "zod";
import {
  judgeSigner,
  keyFingerprint,
  type SignerVerdict,
  type TrustPolicy,
} from "./signer-trust.ts";
import type { SigningKey } from "./signing.ts";

/**
 * A DSSE envelope over an in-toto style statement, so what a run produced can be checked by
 * something that is not this tool.
 *
 * The bundle signature covers the chain head, which binds the evidence to itself. It does not
 * bind the evidence to the patch, the spec, the source commit or the tool that made them, so a
 * reader holding a diff and a bundle had no way to establish they were about each other. The
 * statement below names all of those under one signature.
 *
 * The signature is over DSSE's pre-authentication encoding rather than the payload bytes alone.
 * That is the whole reason the format has one: a signature over the bytes would still verify if
 * the same bytes were reinterpreted as a different kind of document.
 */
export const attestationPredicateType = "https://swarm-orchestrator.dev/attestation/v4";
export const payloadType = "application/vnd.in-toto+json";

export interface AttestationSubject {
  readonly runId: string;
  readonly specDigest: string;
  readonly sourceCommit: string;
  readonly patchDigest: string;
  readonly chainHead: string;
  readonly toolVersion: string;
  readonly executionMode: string;
  readonly verdict: Readonly<Record<string, unknown>>;
}

export interface AttestationStatement {
  readonly _type: "https://in-toto.io/Statement/v1";
  readonly subject: readonly {
    readonly name: string;
    readonly digest: { readonly sha256: string };
  }[];
  readonly predicateType: string;
  readonly predicate: Readonly<Record<string, unknown>>;
}

export interface DsseEnvelope {
  readonly payload: string;
  readonly payloadType: string;
  readonly signatures: readonly {
    readonly keySource?: "keychain" | "ephemeral";
    readonly keyid: string;
    readonly sig: string;
    readonly publicKey: string;
  }[];
}

export function buildAttestation(subject: AttestationSubject): AttestationStatement {
  return {
    _type: "https://in-toto.io/Statement/v1",
    subject: [
      {
        name: `patch:${subject.runId}`,
        digest: { sha256: subject.patchDigest.replace(/^sha256:/, "") },
      },
    ],
    predicateType: attestationPredicateType,
    predicate: {
      runId: subject.runId,
      specDigest: subject.specDigest,
      sourceCommit: subject.sourceCommit,
      chainHead: subject.chainHead,
      toolVersion: subject.toolVersion,
      executionMode: subject.executionMode,
      verdict: subject.verdict,
    },
  };
}

/**
 * DSSE's pre-authentication encoding: the type and the payload, each with its own length, so
 * neither can be moved into the other.
 */
function preAuthenticationEncoding(type: string, payload: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from("DSSEv1", "utf8"),
    Buffer.from(` ${Buffer.byteLength(type, "utf8")} ${type} ${payload.length} `, "utf8"),
    payload,
  ]);
}

export function signAttestation(statement: AttestationStatement, key: SigningKey): DsseEnvelope {
  const payload = Buffer.from(JSON.stringify(statement), "utf8");
  return {
    payload: payload.toString("base64"),
    payloadType,
    signatures: [
      {
        keyid: keyFingerprint(key.publicKeySpki),
        sig: key.sign(preAuthenticationEncoding(payloadType, payload)),
        keySource: key.source,
        publicKey: key.publicKeySpki,
      },
    ],
  };
}

export interface AttestationJudgement {
  readonly integrity: "valid" | "invalid";
  readonly signer: SignerVerdict;
  readonly reason: string;
  readonly statement: AttestationStatement | null;
}

export function verifyAttestation(
  envelope: DsseEnvelope,
  policy: TrustPolicy,
): AttestationJudgement {
  const parsed = envelopeSchema.safeParse(envelope);
  if (!parsed.success) return invalidAttestation(`invalid DSSE envelope: ${parsed.error.message}`);
  const signature = parsed.data.signatures[0];
  if (signature === undefined) {
    return {
      integrity: "invalid",
      signer: "unverified",
      reason: "the envelope carries no signature",
      statement: null,
    };
  }

  const payload = Buffer.from(envelope.payload, "base64");
  let statement: AttestationStatement;
  try {
    statement = statementSchema.parse(JSON.parse(payload.toString("utf8")));
  } catch (cause) {
    return invalidAttestation(`invalid attestation statement: ${String(cause)}`);
  }
  const legacy = statement.predicateType === "https://swarm-orchestrator.dev/attestation/v3";
  const pae = preAuthenticationEncoding(envelope.payloadType, payload);
  const encoded = legacy ? Buffer.from(pae.toString("base64"), "utf8") : pae;
  let holds = false;
  try {
    holds = verifyBytes(
      null,
      encoded,
      createPublicKey({
        key: Buffer.from(signature.publicKey, "base64"),
        format: "der",
        type: "spki",
      }),
      Buffer.from(signature.sig, "base64"),
    );
  } catch {
    holds = false;
  }

  if (!holds) {
    return {
      integrity: "invalid",
      signer: "invalid",
      reason:
        "the signature does not verify over this payload and payload type. Either the payload " +
        "changed after signing, or the type it is being read as is not the type it was signed as",
      statement: null,
    };
  }

  // Consistency held; who signed it is the separate question the trust policy answers, exactly
  // as it does for the bundle signature.
  const judged = judgeSigner(
    encoded,
    {
      algorithm: "ed25519",
      publicKey: signature.publicKey,
      value: signature.sig,
      keySource: signature.keySource ?? "keychain",
    },
    policy,
  );

  return {
    integrity: "valid",
    signer: judged.signer,
    reason: `${legacy ? "legacy v3 base64 signing compatibility; " : "DSSE raw PAE; "}${judged.reason}`,
    statement,
  };
}

const envelopeSchema = z.object({
  payload: z.string().min(1),
  payloadType: z.literal(payloadType),
  signatures: z
    .array(
      z.object({
        keyid: z.string(),
        sig: z.string().min(1),
        publicKey: z.string().min(1),
        keySource: z.enum(["keychain", "ephemeral"]).optional(),
      }),
    )
    .min(1),
});
const statementSchema = z.object({
  _type: z.literal("https://in-toto.io/Statement/v1"),
  predicateType: z.enum([
    attestationPredicateType,
    "https://swarm-orchestrator.dev/attestation/v3",
  ]),
  subject: z
    .array(
      z.object({
        name: z.string().min(1),
        digest: z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/) }),
      }),
    )
    .length(1),
  predicate: z
    .object({
      runId: z.string().min(1),
      specDigest: z.string().min(1),
      sourceCommit: z.string().min(1),
      chainHead: z.string().min(1),
      toolVersion: z.string().min(1),
      executionMode: z.string().min(1),
      verdict: z.record(z.string(), z.unknown()),
    })
    .passthrough(),
});

export function invalidAttestation(reason: string): AttestationJudgement {
  return { integrity: "invalid", signer: "invalid", reason, statement: null };
}
