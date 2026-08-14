import { z } from "zod";
import { digestOfJson, digestPattern, type JsonValue } from "./canonical-json.ts";

/**
 * Bumped whenever the record shape changes. The reserved upgrade path from a plain hash
 * chain to a Merkle history tree (inclusion and consistency proofs anchored off the
 * machine) lands as new fields under a version bump, which is why every consumer reads
 * this field before anything else.
 */
export const ledgerSchemaVersion = 1;

/** The first record's previousHash. A sentinel rather than a digest, so it cannot collide. */
export const genesisHash = "genesis";

/**
 * Widening this list is a compatible change and does not move the schema version: every
 * record already written still validates, and readers switch on the type with a fallback.
 * Changing a field is the incompatible case, and that is what the version bump is for.
 */
export const recordTypes = [
  "session-started",
  "local-endpoint",
  "model-call",
  "tool-call",
  "confirmation",
  "claim",
  "session-stopped",
  "gate-run",
  "ratchet-decision",
  "file-set-declared",
  "file-set-amended",
  "escalation",
  "calibration-run",
  "calibration-summary",
  "routing-decision",
  "reward",
  "worker-started",
  "worker-finished",
  "merge-attempt",
] as const;

export type RecordType = (typeof recordTypes)[number];

const digestSchema = z.string().regex(digestPattern, "expected a sha256:<hex> digest");

export const provenanceTagSchema = z.enum(["user", "model", "tool-output", "file"]);

export const ledgerRecordSchema = z
  .object({
    schemaVersion: z.literal(ledgerSchemaVersion),
    sequence: z.number().int().nonnegative(),
    previousHash: z.union([z.literal(genesisHash), digestSchema]),
    /** Milliseconds from the injected clock, never a direct Date.now call. */
    timestamp: z.number().int(),
    type: z.enum(recordTypes),
    /** Model id for model-authored actions, "harness" for everything the harness did. */
    actor: z.string().min(1),
    payloadDigest: digestSchema,
    provenance: z.array(provenanceTagSchema),
    promptDigest: digestSchema.optional(),
    responseDigest: digestSchema.optional(),
  })
  .superRefine((record, context) => {
    if (record.type !== "model-call") {
      return;
    }
    if (record.promptDigest === undefined || record.responseDigest === undefined) {
      context.addIssue({
        code: "custom",
        message: "a model-call record carries both a promptDigest and a responseDigest",
      });
    }
  });

export type LedgerRecord = z.infer<typeof ledgerRecordSchema>;

export const harnessActor = "harness";

/**
 * The record's own hash, over its canonical bytes. Not stored in the line: a stored hash
 * is one more thing a tamperer updates, whereas a recomputed one has to match the next
 * record's previousHash to survive.
 */
export function hashOfRecord(record: LedgerRecord): string {
  return digestOfJson(record as unknown as JsonValue);
}

export function serializeRecord(record: LedgerRecord): string {
  return JSON.stringify(record);
}
