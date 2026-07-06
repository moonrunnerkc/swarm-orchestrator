// Content hashing for evidence artifacts. Shared by the audit handler (which
// pins each raw execution-grounded evidence file into its ledger entry) and the
// evidence-pack MANIFEST (which pins every packed file). One implementation so
// the ledger's `evidenceSha256` and the MANIFEST's file hash are the same
// algorithm over the same bytes.

import * as crypto from 'crypto';
import * as fs from 'fs';
import { SwarmError } from '../../errors';

/**
 * Compute the lowercase-hex sha256 of a file's bytes.
 *
 * @param filePath the file to hash.
 * @returns the 64-char hex digest.
 * @throws {SwarmError} if the file cannot be read.
 */
export function sha256File(filePath: string): string {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(filePath);
  } catch (err) {
    throw new SwarmError(`could not read evidence file ${filePath}`, 'EVIDENCE_HASH_READ', {
      remediation: 'Ensure the evidence artifact exists and is readable before packing it',
      cause: err,
    });
  }
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * Compute the sha256 of a file, or undefined when the path is absent, undefined,
 * or unreadable. For best-effort pinning where a missing artifact is acceptable
 * (the ledger entry simply omits the hash) rather than an error.
 *
 * @param filePath the file to hash, or undefined.
 * @returns the hex digest, or undefined when the file is missing or unreadable.
 */
export function sha256FileIfPresent(filePath: string | undefined): string | undefined {
  if (filePath === undefined || !fs.existsSync(filePath)) return undefined;
  try {
    return sha256File(filePath);
  } catch {
    return undefined;
  }
}
