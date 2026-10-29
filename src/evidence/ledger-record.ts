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
  "model-call",
  "tool-call",
  "confirmation",
  "verification",
  "session-stopped",
] as const;

export type RecordType = (typeof recordTypes)[number];

const digestSchema = z.string().regex(digestPattern, "expected a sha256:<hex> digest");

const provenanceTagSchema = z.enum(["user", "model", "tool-output", "file"]);

/** Where an input came from: a person, the model, tool output or a file. */
export type ProvenanceTag = z.infer<typeof provenanceTagSchema>;

export const ledgerRecordSchema = z.object({
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
});

export type LedgerRecord = z.infer<typeof ledgerRecordSchema>;

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
