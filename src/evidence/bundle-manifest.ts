import { z } from "zod";
import { bundleSignatureSchema } from "./signing.ts";

/**
 * Format 2 adds the criteria sealed before the loop, a bond per passing gate, and the
 * re-derivation script. A format 1 bundle is still read and still verifies; the verifier
 * holds a format 2 bundle to the seal it promises.
 */
export const bundleFormatVersion = 2;
export const readableBundleFormats = [1, 2] as const;

const workerChainSchema = z.object({
  workerId: z.string().min(1),
  sessionId: z.string().min(1),
  /** Relative to the combined bundle's own directory. */
  directory: z.string().min(1),
  chainHead: z.string().min(1),
  recordCount: z.number().int().nonnegative(),
});

export type WorkerChain = z.infer<typeof workerChainSchema>;

export const bundleManifestSchema = z.object({
  bundleFormat: z.union([z.literal(1), z.literal(2)]),
  ledgerSchemaVersion: z.number().int().positive(),
  sessionId: z.string().min(1),
  exportedAt: z.number().int(),
  recordCount: z.number().int().nonnegative(),
  /** Hash of the last record, which transitively covers every record before it. */
  chainHead: z.string().min(1),
  signature: bundleSignatureSchema,
  /** Every payload digest referenced by the chain, whether or not the blob shipped. */
  blobs: z.array(z.string()),
  missingBlobs: z.array(z.string()),
  claims: z.object({
    verified: z.number().int().nonnegative(),
    unverified: z.number().int().nonnegative(),
  }),
  /**
   * The worker chains this bundle carries, each a complete bundle of its own under
   * `directory`. Empty for an ordinary single-session run, which is why adding it did not
   * move the bundle format: every bundle written before it still parses, and a reader that
   * ignores the field reads exactly what it read before.
   */
  workers: z.array(workerChainSchema).default([]),
});

export type BundleManifest = z.infer<typeof bundleManifestSchema>;

export const bundleFileNames = {
  manifest: "manifest.json",
  ledger: "ledger.jsonl",
  dag: "dag.json",
  verifier: "verify.mjs",
  rederiver: "rederive.mjs",
  review: "review.html",
  blobs: "blobs",
  workers: "workers",
  /**
   * A DSSE envelope binding the patch, the spec, the source commit, the chain head and the
   * verdict under one signature. The bundle signature binds the evidence to itself; this binds
   * it to what it is about, so a reader holding a diff and a bundle can establish they belong
   * together. Absent in a bundle written before this build, which reads as not attested rather
   * than as failed.
   */
  attestation: "attestation.dsse.json",
} as const;
