import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Clock } from "../core/clock.ts";
import type { ProvenanceTag } from "../core/model-client.ts";
import {
  genesisHash,
  hashOfRecord,
  type LedgerRecord,
  ledgerRecordSchema,
  ledgerSchemaVersion,
  type RecordType,
  serializeRecord,
} from "./ledger-record.ts";

export class LedgerWriteFailedError extends Error {
  constructor(path: string, cause: unknown) {
    super(
      `the evidence ledger at ${path} could not be appended to: ` +
        `${cause instanceof Error ? cause.message : String(cause)}. ` +
        "Execution stops here by design: no evidence, no execution.",
    );
    this.name = "LedgerWriteFailedError";
    this.cause = cause;
  }
}

export class LedgerSealedError extends Error {
  constructor(path: string) {
    super(
      `the evidence ledger at ${path} is sealed after an earlier failed append. ` +
        "The chain head is no longer known, so nothing further may be recorded. Start a new session.",
    );
    this.name = "LedgerSealedError";
  }
}

interface LedgerAppend {
  readonly type: RecordType;
  readonly actor: string;
  readonly payloadDigest: string;
  readonly provenance: readonly ProvenanceTag[];
  readonly promptDigest?: string;
  readonly responseDigest?: string;
}

export interface ChainHead {
  readonly hash: string;
  readonly sequence: number;
  readonly recordCount: number;
}

export interface Ledger {
  readonly path: string;
  head(): ChainHead;
  append(entry: LedgerAppend): Promise<LedgerRecord>;
  /** Everything appended in this session, in order. Served from memory, never re-read. */
  records(): readonly LedgerRecord[];
}

interface LedgerOptions {
  readonly path: string;
  readonly clock: Clock;
  /** Injected so a test can drive the abort path without breaking a real filesystem. */
  readonly write?: (path: string, line: string) => Promise<void>;
}

/**
 * Append-only JSONL, one file per session (invariant 2). Every record carries the previous
 * record's hash, appends are serialized so two callers cannot interleave a chain link, and
 * a failed write seals the ledger rather than letting the run continue unrecorded.
 */
export async function openLedger(options: LedgerOptions): Promise<Ledger> {
  const write = options.write ?? appendLine;
  await mkdir(dirname(options.path), { recursive: true });

  const written: LedgerRecord[] = [];
  let previousHash = genesisHash;
  let sequence = 0;
  let sealed = false;
  let pending: Promise<unknown> = Promise.resolve();

  const appendOne = async (entry: LedgerAppend): Promise<LedgerRecord> => {
    if (sealed) {
      throw new LedgerSealedError(options.path);
    }

    const record = ledgerRecordSchema.parse({
      schemaVersion: ledgerSchemaVersion,
      sequence,
      previousHash,
      timestamp: options.clock.now(),
      type: entry.type,
      actor: entry.actor,
      payloadDigest: entry.payloadDigest,
      provenance: [...entry.provenance],
      ...(entry.promptDigest === undefined ? {} : { promptDigest: entry.promptDigest }),
      ...(entry.responseDigest === undefined ? {} : { responseDigest: entry.responseDigest }),
    });

    try {
      await write(options.path, serializeRecord(record));
    } catch (cause) {
      sealed = true;
      throw new LedgerWriteFailedError(options.path, cause);
    }

    previousHash = hashOfRecord(record);
    sequence += 1;
    written.push(record);
    return record;
  };

  return {
    path: options.path,

    head: (): ChainHead => ({
      hash: previousHash,
      sequence: sequence - 1,
      recordCount: written.length,
    }),

    append(entry: LedgerAppend): Promise<LedgerRecord> {
      // Serialized: the previousHash of record N+1 is only knowable once N is on disk.
      const next = pending.then(
        () => appendOne(entry),
        () => appendOne(entry),
      );
      pending = next.catch(() => undefined);
      return next;
    },

    records: () => written,
  };
}

export interface ChainProblem {
  readonly sequence: number;
  readonly detail: string;
}

interface ChainVerification {
  readonly ok: boolean;
  readonly head: string;
  readonly recordCount: number;
  readonly problems: readonly ChainProblem[];
}

/**
 * Recomputes every link. This is the check the embedded verifier reimplements, so keep the
 * two in step: a byte changed anywhere in a record changes that record's hash, which no
 * longer matches the previousHash the next record carries.
 */
export function verifyChain(records: readonly LedgerRecord[]): ChainVerification {
  const problems: ChainProblem[] = [];
  let expectedPrevious = genesisHash;

  for (const [index, record] of records.entries()) {
    if (record.sequence !== index) {
      problems.push({
        sequence: record.sequence,
        detail: `record ${index} declares sequence ${record.sequence}`,
      });
    }
    if (record.previousHash !== expectedPrevious) {
      problems.push({
        sequence: record.sequence,
        detail: `previousHash ${record.previousHash} does not match the recomputed hash ${expectedPrevious} of the record before it`,
      });
    }
    expectedPrevious = hashOfRecord(record);
  }

  return {
    ok: problems.length === 0,
    head: expectedPrevious,
    recordCount: records.length,
    problems,
  };
}

interface ParsedLedger {
  readonly records: readonly LedgerRecord[];
  readonly problems: readonly ChainProblem[];
}

/** Parses JSONL text. An unparseable or schema-invalid line is a problem, not an exception. */
export function parseLedgerText(text: string): ParsedLedger {
  const records: LedgerRecord[] = [];
  const problems: ChainProblem[] = [];

  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim().length === 0) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (cause) {
      problems.push({
        sequence: index,
        detail: `line ${index + 1} is not JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
      continue;
    }
    const validated = ledgerRecordSchema.safeParse(parsed);
    if (!validated.success) {
      problems.push({ sequence: index, detail: `line ${index + 1}: ${validated.error.message}` });
      continue;
    }
    records.push(validated.data);
  }

  return { records, problems };
}

async function appendLine(path: string, line: string): Promise<void> {
  await appendFile(path, `${line}\n`, "utf8");
}
