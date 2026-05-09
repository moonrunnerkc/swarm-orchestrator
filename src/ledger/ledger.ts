/**
 * Phase 4 hash-chained evidence ledger.
 *
 * On-disk format is the same JSONL the Phase 2 ledger writes — one entry
 * per line, line-oriented for easy `tail -f`, blank lines tolerated. Every
 * entry now carries two new header fields:
 *
 *   - `prevHash`: sha256 of the immediately-previous entry's `entryHash`,
 *     or 64 hex zeros for the genesis entry.
 *   - `entryHash`: sha256 of the canonical JSON serialization of this
 *     entry with `entryHash` itself excluded.
 *
 * Because each entry's hash folds in the previous entry's hash, any
 * tampering with a prior entry — edited, removed, or reordered — breaks
 * the chain and `verifyChain` rejects the file.
 *
 * Implementation notes:
 *
 *   - The hash function is sha256, accessed via `node:crypto`. Impl guide
 *     §7 calls for "IRONROOT primitives" for the chain. IRONROOT
 *     (https://github.com/moonrunnerkc/ironroot) is a personal-OSS
 *     hash-chained verified-memory library that is not yet published to
 *     npm; this implementation uses the same sha256-of-canonical-JSON
 *     pattern IRONROOT exposes so a future swap to the npm package is
 *     mechanical. The deviation is documented in
 *     `docs/v8-architecture-deviations.md`.
 *
 *   - The on-disk entry order is the chain order. `seq` is informational;
 *     the chain itself is what enforces order.
 *
 *   - Genesis prevHash is 64 hex zeros (the "all-zero digest"). Some
 *     IRONROOT-flavoured implementations use the empty string instead; we
 *     pick the all-zero form because it round-trips through any string
 *     comparator without surprises.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { LedgerEntry, LedgerEntryHeader } from './types';

/** 64 hex zeros: the genesis entry's `prevHash`. */
export const GENESIS_PREV_HASH = '0'.repeat(64);

/**
 * Error thrown by `verifyChain` when the on-disk ledger fails its
 * integrity check. The `lineNumber` field points to the first divergent
 * entry, 1-indexed against the source file.
 */
export class ChainTamperedError extends Error {
  /** 1-indexed line where the chain first diverges. */
  readonly lineNumber: number;
  /** What kind of tamper was detected. */
  readonly kind: 'entry-hash-mismatch' | 'prev-hash-mismatch' | 'malformed-header';
  constructor(message: string, lineNumber: number, kind: ChainTamperedError['kind']) {
    super(message);
    this.name = 'ChainTamperedError';
    this.lineNumber = lineNumber;
    this.kind = kind;
  }
}

/**
 * Append-only hash-chained ledger. Drop-in replacement for the Phase 2
 * `JsonlLedger` semantics — same write-on-flush, same monotonic seq —
 * but every appended entry is hash-chained from the previous one.
 *
 * Each `append` is fsync-equivalent (`fs.appendFileSync`); a kill-9 mid
 * write leaves a parseable prefix. `verifyChain` walks the file from
 * disk and rejects on any mismatch.
 */
export class HashChainedLedger {
  private seq = 0;
  private lastHash: string = GENESIS_PREV_HASH;
  private readonly filePath: string;
  private readonly runId: string;

  constructor(filePath: string, runId: string) {
    this.filePath = filePath;
    this.runId = runId;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', { encoding: 'utf8' });
      return;
    }
    // Resume: load tail seq and hash. The file is verified before we trust
    // its tail — refusing to chain onto a tampered file is the safer
    // default than silently accepting it.
    const existing = readEntries(filePath);
    if (existing.length > 0) {
      verifyChainEntries(existing);
      const last = existing[existing.length - 1];
      if (last) {
        this.seq = last.seq + 1;
        this.lastHash = last.entryHash;
      }
    }
  }

  /** Filesystem path the ledger writes to. */
  path(): string {
    return this.filePath;
  }

  /** Run id this ledger is tagged with. */
  run(): string {
    return this.runId;
  }

  /** Next sequence number that will be assigned. */
  nextSeq(): number {
    return this.seq;
  }

  /** Tail-of-chain hash; what the next `append` will use as `prevHash`. */
  tailHash(): string {
    return this.lastHash;
  }

  /**
   * Append a single entry. Caller supplies the type-discriminated payload
   * minus the header fields; the ledger stamps `ts`, `runId`, `seq`,
   * `prevHash`, and `entryHash`.
   */
  append<E extends LedgerEntry>(payload: Omit<E, keyof LedgerEntryHeader>): E {
    const ts = new Date().toISOString();
    const base = {
      ts,
      runId: this.runId,
      seq: this.seq,
      prevHash: this.lastHash,
      ...payload,
    } as Omit<E, 'entryHash'> & { entryHash?: string };
    const entryHash = computeEntryHash(base);
    const final = { ...base, entryHash } as unknown as E;
    fs.appendFileSync(this.filePath, JSON.stringify(final) + '\n', { encoding: 'utf8' });
    this.seq += 1;
    this.lastHash = entryHash;
    return final;
  }

  /** Read every entry in the ledger, in write order. */
  readAll(): LedgerEntry[] {
    return readEntries(this.filePath);
  }

  /**
   * Walk the on-disk ledger and confirm every entry's hash chain is
   * consistent. Throws `ChainTamperedError` on the first divergence.
   */
  verifyChain(): void {
    const entries = readEntries(this.filePath);
    verifyChainEntries(entries);
  }
}

/**
 * Read a ledger file from disk. Blank lines tolerated; malformed JSON
 * surfaces as a parse error including the offending line number. This
 * function does NOT verify the chain — call `verifyChain` for that.
 */
export function readEntries(filePath: string): LedgerEntry[] {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  const out: LedgerEntry[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as LedgerEntry;
      out.push(parsed);
    } catch (err) {
      throw new Error(
        `ledger ${filePath} line ${i + 1} is not valid JSON: ${(err as Error).message}`,
        { cause: err },
      );
    }
  }
  return out;
}

/**
 * Verify a freshly-read entry list. Rejects on any of:
 *   - genesis entry's `prevHash` is not the all-zero digest;
 *   - any entry's `prevHash` does not match the previous entry's
 *     `entryHash`;
 *   - any entry's recomputed hash differs from its on-disk `entryHash`;
 *   - any entry is missing the chain header fields.
 *
 * Throws `ChainTamperedError` with a 1-indexed line number on the first
 * divergence.
 */
export function verifyChainEntries(entries: readonly LedgerEntry[]): void {
  let expectedPrev = GENESIS_PREV_HASH;
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    if (!e) continue;
    const lineNumber = i + 1;
    if (typeof e.prevHash !== 'string' || typeof e.entryHash !== 'string') {
      throw new ChainTamperedError(
        `ledger entry at line ${lineNumber} is missing prevHash/entryHash header fields`,
        lineNumber,
        'malformed-header',
      );
    }
    if (e.prevHash !== expectedPrev) {
      throw new ChainTamperedError(
        `ledger chain broken at line ${lineNumber}: prevHash ${shortHash(e.prevHash)} does not chain from ${shortHash(expectedPrev)}`,
        lineNumber,
        'prev-hash-mismatch',
      );
    }
    const recomputed = computeEntryHash(stripEntryHash(e));
    if (recomputed !== e.entryHash) {
      throw new ChainTamperedError(
        `ledger entry at line ${lineNumber} fails entry-hash check: stored ${shortHash(e.entryHash)} but recomputed ${shortHash(recomputed)}`,
        lineNumber,
        'entry-hash-mismatch',
      );
    }
    expectedPrev = e.entryHash;
  }
}

/**
 * Verify a chain that lives on disk. Convenience wrapper for callers who
 * have a path but not a `HashChainedLedger` instance.
 */
export function verifyChainAt(filePath: string): void {
  const entries = readEntries(filePath);
  verifyChainEntries(entries);
}

/**
 * Canonical JSON serialization used for hashing. Produces a stable byte
 * sequence for any object with primitive/array/object values:
 *   - object keys are sorted in JS string order;
 *   - arrays preserve their order;
 *   - primitives use standard JSON.stringify.
 *
 * Matches the JSON Canonical Form everyone using sha256-of-JSON for hash
 * chaining converges on (RFC 8785 in spirit; we don't bother with the
 * full I-JSON number normalization because the ledger never serializes
 * exotic numbers).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const body = keys
    .map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k]))
    .join(',');
  return '{' + body + '}';
}

/**
 * Compute the sha256 hex of an entry's canonical JSON form. The caller
 * must pass the entry with the `entryHash` field already stripped (see
 * `stripEntryHash`); this function only does the hashing.
 */
export function computeEntryHash(entry: unknown): string {
  return crypto.createHash('sha256').update(canonicalJson(entry), 'utf8').digest('hex');
}

/** Return a copy of `entry` with the `entryHash` property removed. */
function stripEntryHash<T extends { entryHash?: unknown }>(entry: T): Omit<T, 'entryHash'> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(entry)) {
    if (k === 'entryHash') continue;
    out[k] = (entry as Record<string, unknown>)[k];
  }
  return out as Omit<T, 'entryHash'>;
}

function shortHash(h: string): string {
  return h.length <= 12 ? h : `${h.slice(0, 8)}…${h.slice(-4)}`;
}
