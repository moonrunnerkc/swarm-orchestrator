// The evidence-pack MANIFEST: an integrity index over every replay-identical
// file in a pack. Each entry pins a file's sha256 and byte length so a reviewer
// can recompute and confirm nothing was altered after the audit. The MANIFEST
// itself is replay-identical: it lists only the reproducible files (the two
// AIBOMs and the content-addressed raw evidence), sorted by path, with a verdict
// section that is a pure function of the audit's conclusions. The per-run ledger
// is deliberately excluded here and pinned in the separate run-record sidecar,
// so the MANIFEST bytes do not vary across two audits of the same PR.

import * as fs from 'fs';
import * as path from 'path';
import { SwarmError } from '../../errors';
import { sha256File } from './hashing';
import type { TimestampBasis } from '../aibom/bom-identity';

export const EVIDENCE_MANIFEST_SCHEMA = 'swarm-evidence-pack/v1';
export const EVIDENCE_MANIFEST_FILENAME = 'MANIFEST.json';

/** A file's role in the pack. Both are part of the replay-identical set. */
export type ManifestFileRole = 'attestation' | 'evidence';

/** One integrity-pinned file in the pack. `path` is a POSIX-relative path. */
export interface ManifestFileEntry {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly role: ManifestFileRole;
}

/** The audited subject, as recorded in the ledger's started entry. */
export interface ManifestSubject {
  readonly repository: string;
  readonly prNumber: number | null;
  readonly headSha: string;
  readonly baseSha: string;
}

/** The two-sided verdict, a pure function of the audit conclusions. */
export interface ManifestVerdict {
  readonly negativeGateClean: boolean;
  /** Present only when the positive merge-safety gate ran (a work-verified entry). */
  readonly merge?: {
    readonly verdict: 'auto-merge' | 'human';
    readonly reasons: readonly string[];
  };
}

/** The MANIFEST document. Replay-identical for a given PR head. */
export interface EvidenceManifest {
  readonly schema: typeof EVIDENCE_MANIFEST_SCHEMA;
  readonly subject: ManifestSubject;
  readonly tool: { readonly name: string; readonly version: string };
  readonly identity: {
    readonly serialNumber: string;
    readonly timestamp: string;
    readonly timestampBasis: TimestampBasis;
  };
  readonly verdict: ManifestVerdict;
  readonly files: readonly ManifestFileEntry[];
}

export interface BuildManifestInput {
  readonly packDir: string;
  readonly subject: ManifestSubject;
  readonly toolVersion: string;
  readonly identity: {
    readonly serialNumber: string;
    readonly timestamp: string;
    readonly timestampBasis: TimestampBasis;
  };
  readonly verdict: ManifestVerdict;
  /** Pack-relative POSIX paths with their role, in any order. */
  readonly files: ReadonlyArray<{ path: string; role: ManifestFileRole }>;
}

/**
 * Build the MANIFEST by hashing each listed file inside the pack directory.
 * Entries are sorted by path so the output is deterministic regardless of
 * discovery order.
 *
 * @param input the pack directory, subject, identity, verdict, and file list.
 * @returns the MANIFEST document.
 * @throws {SwarmError} if a listed file cannot be read.
 */
export function buildManifest(input: BuildManifestInput): EvidenceManifest {
  const sorted = [...input.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const files: ManifestFileEntry[] = sorted.map((f) => {
    const abs = path.join(input.packDir, f.path);
    return { path: f.path, sha256: sha256File(abs), bytes: fs.statSync(abs).size, role: f.role };
  });
  return {
    schema: EVIDENCE_MANIFEST_SCHEMA,
    subject: input.subject,
    tool: { name: 'swarm-audit', version: input.toolVersion },
    identity: input.identity,
    verdict: input.verdict,
    files,
  };
}

/**
 * Serialize a MANIFEST to canonical, replay-identical JSON with a trailing
 * newline.
 *
 * @param manifest the MANIFEST to serialize.
 * @returns the JSON text.
 */
export function serializeManifest(manifest: EvidenceManifest): string {
  return JSON.stringify(manifest, null, 2) + '\n';
}

/** The outcome of re-verifying a pack against its MANIFEST. */
export interface ManifestVerifyResult {
  readonly ok: boolean;
  /** Files whose recomputed sha256 did not match, or that were missing. */
  readonly mismatches: ReadonlyArray<{
    readonly path: string;
    readonly expected: string;
    readonly actual: string | 'missing';
  }>;
}

/**
 * Re-verify a pack directory against its MANIFEST: recompute every listed file's
 * sha256 and compare. A missing file is a mismatch with actual "missing".
 *
 * @param packDir the pack directory containing MANIFEST.json.
 * @returns ok=true iff every listed file is present with a matching hash.
 * @throws {SwarmError} if the MANIFEST is absent or unparseable.
 */
export function verifyManifest(packDir: string): ManifestVerifyResult {
  const manifestPath = path.join(packDir, EVIDENCE_MANIFEST_FILENAME);
  let manifest: EvidenceManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as EvidenceManifest;
  } catch (err) {
    throw new SwarmError(`could not read pack MANIFEST at ${manifestPath}`, 'EVIDENCE_MANIFEST_READ', {
      remediation: 'Ensure the directory is a swarm evidence pack with a MANIFEST.json',
      cause: err,
    });
  }
  const mismatches: Array<{ path: string; expected: string; actual: string | 'missing' }> = [];
  for (const entry of manifest.files) {
    const abs = path.join(packDir, entry.path);
    if (!fs.existsSync(abs)) {
      mismatches.push({ path: entry.path, expected: entry.sha256, actual: 'missing' });
      continue;
    }
    const actual = sha256File(abs);
    if (actual !== entry.sha256) {
      mismatches.push({ path: entry.path, expected: entry.sha256, actual });
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}
