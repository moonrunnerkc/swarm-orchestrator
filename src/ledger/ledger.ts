// Hash-chained evidence ledger: each entry's entryHash folds in the
// previous entry's hash, so tampering breaks `verifyChain`. Uses the
// sha256-of-canonical-JSON pattern so a swap to an IRONROOT-style
// library is mechanical.
//
// Genesis prevHash is 64 hex zeros — string-comparator-safe vs the
// empty-string variant some implementations use.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { SwarmError } from '../errors';
import type { LedgerAgentAttribution, LedgerEntry, LedgerEntryHeader } from './types';

export const GENESIS_PREV_HASH = '0'.repeat(64);

export class ChainTamperedError extends SwarmError {
  readonly lineNumber: number;
  readonly kind: 'entry-hash-mismatch' | 'prev-hash-mismatch' | 'malformed-header';
  constructor(message: string, lineNumber: number, kind: ChainTamperedError['kind'], remediation?: string) {
    super(message, 'CHAIN_TAMPERED', remediation !== undefined ? { remediation } : undefined);
    this.name = 'ChainTamperedError';
    this.lineNumber = lineNumber;
    this.kind = kind;
  }
}

// Each append is fsync-equivalent (appendFileSync); a kill-9 mid-write
// leaves a parseable prefix.
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
    // Verify before chaining onto an existing file: refusing to chain
    // onto tampered tail is safer than silently accepting it.
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

  path(): string {
    return this.filePath;
  }

  run(): string {
    return this.runId;
  }

  nextSeq(): number {
    return this.seq;
  }

  tailHash(): string {
    return this.lastHash;
  }

  // Stamps ts, runId, seq, prevHash, entryHash. Optional `aiAgent`
  // attribution flows into the canonical-JSON hash chain when provided
  // — v10 audit pipelines pass it; pre-v10 callers omit it and the
  // emitted JSON stays byte-identical to legacy output.
  append<E extends LedgerEntry>(
    payload: Omit<E, keyof LedgerEntryHeader>,
    opts?: { aiAgent?: LedgerAgentAttribution },
  ): E {
    const ts = new Date().toISOString();
    const agentField =
      opts?.aiAgent !== undefined ? { aiAgent: opts.aiAgent } : {};
    const base = {
      ts,
      runId: this.runId,
      seq: this.seq,
      prevHash: this.lastHash,
      ...agentField,
      ...payload,
    } as Omit<E, 'entryHash'> & { entryHash?: string };
    const entryHash = computeEntryHash(base);
    const final = { ...base, entryHash } as unknown as E;
    fs.appendFileSync(this.filePath, JSON.stringify(final) + '\n', { encoding: 'utf8' });
    this.seq += 1;
    this.lastHash = entryHash;
    return final;
  }

  readAll(): LedgerEntry[] {
    return readEntries(this.filePath);
  }

  verifyChain(): void {
    const entries = readEntries(this.filePath);
    verifyChainEntries(entries);
  }
}

// Does NOT verify the chain — call `verifyChain` for that.
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
        'Try: delete the corrupted ledger file and re-run, or restore from a backup',
      );
    }
    if (e.prevHash !== expectedPrev) {
      throw new ChainTamperedError(
        `ledger chain broken at line ${lineNumber}: prevHash ${shortHash(e.prevHash)} does not chain from ${shortHash(expectedPrev)}`,
        lineNumber,
        'prev-hash-mismatch',
        'Try: delete the corrupted ledger file and re-run, or restore from a backup',
      );
    }
    const recomputed = computeEntryHash(stripEntryHash(e));
    if (recomputed !== e.entryHash) {
      throw new ChainTamperedError(
        `ledger entry at line ${lineNumber} fails entry-hash check: stored ${shortHash(e.entryHash)} but recomputed ${shortHash(recomputed)}`,
        lineNumber,
        'entry-hash-mismatch',
        'Try: delete the corrupted ledger file and re-run, or restore from a backup',
      );
    }
    expectedPrev = e.entryHash;
  }
}

export function verifyChainAt(filePath: string): void {
  const entries = readEntries(filePath);
  verifyChainEntries(entries);
}

// RFC 8785 in spirit (without full I-JSON number normalization — the
// ledger never serializes exotic numbers): keys sorted in JS string
// order, arrays preserve order, primitives via JSON.stringify.
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

// Caller must pass the entry with `entryHash` already stripped.
export function computeEntryHash(entry: unknown): string {
  return crypto.createHash('sha256').update(canonicalJson(entry), 'utf8').digest('hex');
}

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
