import * as crypto from 'crypto';
import {
  type ObligationV1,
  type ObligationType,
  OBLIGATION_TYPES,
} from './types';

/**
 * Sort obligations into the canonical order used for hashing and on-disk
 * serialization.
 *
 * Order is:
 *   1. By type, in the order declared by `OBLIGATION_TYPES`.
 *   2. Within each type, by the obligation's payload field (path or command)
 *      using JS string comparison (UTF-16 code units).
 *
 * The validator already rejects duplicates within a type, so within-type
 * ties cannot occur in valid input.
 */
export function canonicalSort(obligations: ObligationV1[]): ObligationV1[] {
  const typeOrder = new Map<ObligationType, number>(
    OBLIGATION_TYPES.map((t, i) => [t, i] as const),
  );
  const copy = obligations.slice();
  copy.sort((a, b) => {
    const ta = typeOrder.get(a.type) ?? Number.MAX_SAFE_INTEGER;
    const tb = typeOrder.get(b.type) ?? Number.MAX_SAFE_INTEGER;
    if (ta !== tb) return ta - tb;
    return payloadValue(a).localeCompare(payloadValue(b), 'en', { sensitivity: 'variant' });
  });
  return copy;
}

function payloadValue(o: ObligationV1): string {
  return o.type === 'file-must-exist' ? o.path : o.command;
}

/**
 * Render an obligation list as canonical JSONL bytes: one obligation per
 * line, lines terminated with LF, no trailing whitespace, properties emitted
 * in a stable order matching the schema declaration order.
 *
 * The output is suitable as the contract.jsonl on-disk format and as the
 * input to `contractHash`.
 */
export function canonicalSerialize(obligations: ObligationV1[]): string {
  const sorted = canonicalSort(obligations);
  const lines: string[] = [];
  for (const o of sorted) {
    lines.push(stableStringifyObligation(o));
  }
  return lines.length === 0 ? '' : lines.join('\n') + '\n';
}

function stableStringifyObligation(o: ObligationV1): string {
  if (o.type === 'file-must-exist') {
    return JSON.stringify({ type: o.type, path: o.path });
  }
  // build-must-pass and test-must-pass
  return JSON.stringify({ type: o.type, command: o.command });
}

/**
 * Sha256 of the canonical JSONL bytes for a given obligation list.
 *
 * Provenance metadata (extractor, model, temperature, prompt hash) is NOT
 * part of the contract hash; only the bytes a verifier needs to enforce the
 * contract are hashed. This matches impl guide §4: "hash-stable: identical
 * input produces identical contract output."
 *
 * @returns full hex digest (lowercase, 64 chars).
 */
export function contractHash(obligations: ObligationV1[]): string {
  const canonical = canonicalSerialize(obligations);
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Short filesystem-safe contract id derived from the contract hash. 16 hex
 * chars (~64 bits) is enough to disambiguate every contract a single user
 * will ever produce while remaining short enough for directory names.
 */
export function contractIdFromHash(hash: string): string {
  if (hash.length < 16) {
    throw new Error(`contract hash "${hash}" is shorter than 16 chars; refusing to derive id`);
  }
  return hash.slice(0, 16);
}
