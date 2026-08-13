import { z } from "zod";
import { bundleSignatureSchema } from "./signing.ts";

export const bundleFormatVersion = 1;

export const bundleManifestSchema = z.object({
  bundleFormat: z.literal(bundleFormatVersion),
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
});

export type BundleManifest = z.infer<typeof bundleManifestSchema>;

export const bundleFileNames = {
  manifest: "manifest.json",
  ledger: "ledger.jsonl",
  dag: "dag.json",
  verifier: "verify.mjs",
  review: "review.html",
  blobs: "blobs",
} as const;
