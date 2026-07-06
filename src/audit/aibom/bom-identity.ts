// Deterministic identity for the AIBOM documents in an evidence pack.
//
// The default CycloneDX/SPDX emitters stamp a random serialNumber
// (crypto.randomUUID) and the ledger's wall-clock timestamp, so two audits of
// the same PR produce different bytes. An evidence pack must instead be
// replay-identical: run the audit twice, `diff -r` the two packs, get nothing.
// That requires the AIBOM identity to be a pure function of the run inputs.
//
// serialNumber: an RFC-4122 v5 UUID (namespace + name), where the name is the
// canonical JSON of the run inputs (repo, PR number, head/base SHA, detector
// versions, tool version). Same inputs -> same UUID, always.
//
// timestamp: we do NOT fabricate a wall-clock-looking time. A synthesized ISO
// string derived from a SHA would read to a procurement reviewer as a real
// generation time when it is not. Instead the pinned time honors
// SOURCE_DATE_EPOCH (the reproducible-builds standard); when it is unset the
// timestamp is the Unix epoch and `timestampBasis` records why, so the field is
// never mistaken for a real clock reading. Set SOURCE_DATE_EPOCH to pin a real
// build time into the pack.

import * as crypto from 'crypto';
import { canonicalJson } from '../../ledger/ledger';

/** Fixed namespace UUID for swarm-audit AIBOM identities. Stable forever: the
 *  serialNumber of every past evidence pack folds this value, so it must not
 *  change. It is a namespace label, not a versioned value. */
export const SWARM_BOM_NAMESPACE_UUID = '4e2b0c9a-1f3d-4a6b-9c8e-7d5f2a1b0c3e';

/** Canonical epoch ISO for an evidence pack when SOURCE_DATE_EPOCH is unset. */
export const EVIDENCE_PACK_EPOCH_SENTINEL = new Date(0).toISOString();

/** Why the pinned timestamp holds the value it does. */
export type TimestampBasis = 'source-date-epoch' | 'source-date-epoch-unset';

/** The deterministic identity stamped into an evidence pack's AIBOM documents. */
export interface BomIdentity {
  /** urn:uuid:<v5 uuid over the run inputs>. */
  readonly serialNumber: string;
  /** ISO 8601 pinned time (SOURCE_DATE_EPOCH or the epoch sentinel). */
  readonly timestamp: string;
  /** Why `timestamp` holds its value, so a reader never reads it as wall-clock. */
  readonly timestampBasis: TimestampBasis;
}

/** The run inputs that determine the identity. Every field is immutable for a
 *  given PR head, so the derived identity is stable across replays. */
export interface BomIdentitySeed {
  readonly repository: string;
  readonly prNumber: number | null;
  readonly headSha: string;
  readonly baseSha: string;
  readonly detectorVersions: Record<string, string>;
  readonly toolVersion: string;
}

/**
 * Derive the replay-identical AIBOM identity from the run inputs.
 *
 * @param seed the immutable run inputs (repo, PR number, SHAs, detector and
 *   tool versions).
 * @param sourceDateEpoch the SOURCE_DATE_EPOCH value (seconds since the Unix
 *   epoch) when the operator pinned one; omit to use the epoch sentinel.
 * @returns a serialNumber and timestamp that are pure functions of the inputs.
 */
export function deriveBomIdentity(
  seed: BomIdentitySeed,
  sourceDateEpoch?: number,
): BomIdentity {
  const name = canonicalJson({
    repository: seed.repository,
    prNumber: seed.prNumber,
    headSha: seed.headSha,
    baseSha: seed.baseSha,
    detectorVersions: seed.detectorVersions,
    toolVersion: seed.toolVersion,
  });
  const serialNumber = `urn:uuid:${uuidV5(SWARM_BOM_NAMESPACE_UUID, name)}`;
  if (sourceDateEpoch !== undefined) {
    return {
      serialNumber,
      timestamp: new Date(sourceDateEpoch * 1000).toISOString(),
      timestampBasis: 'source-date-epoch',
    };
  }
  return {
    serialNumber,
    timestamp: EVIDENCE_PACK_EPOCH_SENTINEL,
    timestampBasis: 'source-date-epoch-unset',
  };
}

/**
 * Read SOURCE_DATE_EPOCH from an environment map as a non-negative integer of
 * seconds. Returns undefined when unset, empty, or not a valid integer, so a
 * malformed value falls back to the epoch sentinel rather than a bogus time.
 *
 * @param env the environment to read (defaults to process.env).
 * @returns the epoch seconds, or undefined when unset or malformed.
 */
export function readSourceDateEpoch(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  const raw = (env.SOURCE_DATE_EPOCH ?? '').trim();
  if (raw.length === 0) return undefined;
  if (!/^\d+$/.test(raw)) return undefined;
  const seconds = Number.parseInt(raw, 10);
  return Number.isSafeInteger(seconds) ? seconds : undefined;
}

/**
 * Compute an RFC-4122 version-5 (SHA-1, name-based) UUID.
 *
 * @param namespace a UUID string (the namespace identifier).
 * @param name the name to hash within the namespace.
 * @returns the 8-4-4-4-12 lowercase-hex UUID string.
 * @throws {Error} if `namespace` is not a parseable UUID.
 */
export function uuidV5(namespace: string, name: string): string {
  const nsBytes = uuidToBytes(namespace);
  const hash = crypto.createHash('sha1');
  hash.update(nsBytes);
  hash.update(Buffer.from(name, 'utf8'));
  const digest = hash.digest();
  const bytes = digest.subarray(0, 16);
  // Version 5 in the high nibble of byte 6; RFC-4122 variant in byte 8.
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32 || !/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new Error(
      `uuidV5: namespace "${uuid}" is not a valid UUID; expected 32 hex digits`,
    );
  }
  return Buffer.from(hex, 'hex');
}

function bytesToUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20, 32)}`
  );
}
