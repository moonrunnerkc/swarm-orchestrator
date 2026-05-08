import * as fs from 'fs';
import * as path from 'path';
import type { LedgerEntry, LedgerEntryHeader } from './types';

/**
 * Append-only JSONL ledger. Phase 2 implementation. Writes are flushed
 * synchronously so a kill-9 at any point leaves a parseable prefix; the
 * Phase 4 hash chain layers on top of this same on-disk format.
 *
 * The on-disk format is one JSON object per line. The reader skips blank
 * lines and rejects malformed JSON. Round-trip is lossless.
 */
export class JsonlLedger {
  private seq = 0;
  private readonly filePath: string;
  private readonly runId: string;

  constructor(filePath: string, runId: string) {
    this.filePath = filePath;
    this.runId = runId;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', { encoding: 'utf8' });
    } else {
      // Resuming an existing ledger: load the next sequence number.
      const existing = readEntries(filePath);
      if (existing.length > 0) {
        const last = existing[existing.length - 1];
        if (last) this.seq = last.seq + 1;
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

  /**
   * Append a single entry. Caller supplies the type-discriminated payload
   * minus the header fields; the ledger stamps `ts`, `runId`, and `seq`.
   */
  append<E extends LedgerEntry>(payload: Omit<E, keyof LedgerEntryHeader>): E {
    const entry = {
      ts: new Date().toISOString(),
      runId: this.runId,
      seq: this.seq,
      ...payload,
    } as unknown as E;
    fs.appendFileSync(this.filePath, JSON.stringify(entry) + '\n', { encoding: 'utf8' });
    this.seq += 1;
    return entry;
  }

  /** Read every entry in the ledger, in write order. */
  readAll(): LedgerEntry[] {
    return readEntries(this.filePath);
  }
}

/**
 * Read a ledger file from disk. Blank lines tolerated; malformed JSON
 * surfaces as a parse error including the offending line number.
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
