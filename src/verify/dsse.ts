import { execFile } from "node:child_process";
import { createPublicKey, verify } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ResolvedKey, SigningKey } from "./signing.ts";

export const statementType = "https://in-toto.io/Statement/v1";
export const payloadType = "application/vnd.in-toto+json";
export const bundleMediaType = "application/vnd.dev.sigstore.bundle.v0.3+json";

const envelopeSchema = z.object({
  payloadType: z.literal(payloadType),
  payload: z.string().min(1),
  signatures: z.array(z.object({ keyid: z.string().optional(), sig: z.string().min(1) })).min(1),
});
export type Envelope = z.infer<typeof envelopeSchema>;

const bundleSchema = z.object({
  mediaType: z.string(),
  dsseEnvelope: envelopeSchema,
});

/** DSSE pre-authentication encoding: what the signature actually covers. */
export function pae(type: string, body: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${Buffer.byteLength(type)} ${type} ${body.length} `),
    body,
  ]);
}

export function signStatement(statement: unknown, key: SigningKey): Envelope {
  const body = Buffer.from(JSON.stringify(statement));
  // keyid stays empty: DSSE makes it an unauthenticated hint, and cosign skips a signature
  // whose keyid differs from the one it derives. The bundle carries the fingerprint instead.
  const sig = key.sign(pae(payloadType, body)).toString("base64");
  return { payloadType, payload: body.toString("base64"), signatures: [{ keyid: "", sig }] };
}

/** A Sigstore bundle holding the envelope, verifiable with `cosign verify-blob-attestation`. */
export function bundleOf(envelope: Envelope, key: SigningKey): unknown {
  return {
    mediaType: bundleMediaType,
    verificationMaterial: { publicKey: { hint: key.fingerprint }, tlogEntries: [] },
    dsseEnvelope: envelope,
  };
}

/** The envelope from a bundle or a bare envelope, or null where it is neither. */
export function envelopeOf(document: unknown): Envelope | null {
  const bundle = bundleSchema.safeParse(document);
  if (bundle.success) return bundle.data.dsseEnvelope;
  const bare = envelopeSchema.safeParse(document);
  return bare.success ? bare.data : null;
}

export function envelopeVerifies(envelope: Envelope, publicKeyPem: string): boolean {
  const key = createPublicKey(publicKeyPem);
  const message = pae(envelope.payloadType, Buffer.from(envelope.payload, "base64"));
  return envelope.signatures.some((signature) =>
    verify(null, message, key, Buffer.from(signature.sig, "base64")),
  );
}

export class CosignError extends Error {
  constructor(detail: string) {
    super(`cosign could not sign the statement: ${detail}`);
    this.name = "CosignError";
  }
}

/**
 * Keyless signing through Sigstore: cosign signs the finished statement and writes a bundle in
 * the same format the ed25519 path writes. Needs cosign on PATH and an identity it can use.
 */
export async function signWithCosign(
  statement: unknown,
  scratch: string,
  bundlePath: string,
): Promise<void> {
  const statementPath = join(scratch, "statement.json");
  await writeFile(statementPath, JSON.stringify(statement));
  const args = ["attest-blob", "--yes", "--statement", statementPath, "--bundle", bundlePath];
  await new Promise<void>((settle, fail) => {
    execFile("cosign", args, { timeout: 300_000 }, (error, _stdout, stderr) => {
      if (error === null) settle();
      else if ((error as NodeJS.ErrnoException).code === "ENOENT")
        fail(new CosignError("cosign is not on PATH; install it or sign without --sigstore"));
      else fail(new CosignError(stderr.trim() || error.message));
    });
  });
  // Fail here rather than hand a reader a bundle nothing can parse.
  if (envelopeOf(JSON.parse(await readFile(bundlePath, "utf8"))) === null) {
    throw new CosignError(`${bundlePath} holds no DSSE envelope`);
  }
}

export interface WrittenAttestation {
  readonly bundle: string;
  readonly patch: string;
  /** The public key to verify against; null where Sigstore signed keylessly. */
  readonly publicKey: string | null;
  readonly notice: string | null;
}

/**
 * Writes the patch, the signed bundle and the public key into one owner-only directory. The
 * patch is written first because the bundle's subject names its digest.
 */
export async function writeAttestation(
  statement: unknown,
  patch: Buffer,
  directory: string,
  options: { readonly sigstore: boolean; readonly resolveKey: () => Promise<ResolvedKey> },
): Promise<WrittenAttestation> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const paths = {
    bundle: join(directory, "attestation.sigstore.json"),
    patch: join(directory, "change.patch"),
    publicKey: join(directory, "attestation.pub.pem"),
  };
  await writeFile(paths.patch, patch, { mode: 0o600 });
  if (options.sigstore) {
    await signWithCosign(statement, directory, paths.bundle);
    return { bundle: paths.bundle, patch: paths.patch, publicKey: null, notice: null };
  }
  const { key, notice } = await options.resolveKey();
  const bundle = bundleOf(signStatement(statement, key), key);
  await writeFile(paths.bundle, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
  await writeFile(paths.publicKey, key.publicKeyPem, { mode: 0o644 });
  return { ...paths, notice };
}
