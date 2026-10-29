import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { type BlobStore, openBlobStore } from "./blob-store.ts";
import type { JsonValue } from "./canonical-json.ts";
import { type ChainHead, type Ledger, openLedger } from "./ledger.ts";
import type { LedgerRecord, ProvenanceTag, RecordType } from "./ledger-record.ts";
import { scrubJson } from "./scrub-json.ts";

interface EvidenceEntry {
  readonly type: RecordType;
  readonly actor: string;
  readonly provenance: readonly ProvenanceTag[];
  readonly payload: JsonValue;
}

interface RecordedEvidence {
  readonly record: LedgerRecord;
  /** Which known-pattern scrubs fired on the way in. Labels only, never the matched text. */
  readonly redactions: readonly string[];
}

export interface EvidenceRecorder {
  readonly sessionId: string;
  readonly directory: string;
  readonly ledgerPath: string;
  readonly blobs: BlobStore;
  record(entry: EvidenceEntry): Promise<RecordedEvidence>;
  head(): ChainHead;
  records(): readonly LedgerRecord[];
}

export function createSessionId(now: number): string {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, "").slice(0, 15);
  return `${stamp}-${randomBytes(3).toString("hex")}`;
}

/**
 * One run's evidence: payloads scrubbed of known credential patterns and stored by SHA-256,
 * each named by a record on an append-only hash chain. The session root lives outside the
 * workspace and is denied to the agent's commands.
 */
export async function openEvidenceSession(options: {
  readonly root: string;
  readonly sessionId: string;
  readonly now: () => number;
  readonly ledgerWrite?: (path: string, line: string) => Promise<void>;
}): Promise<EvidenceRecorder> {
  const directory = join(options.root, options.sessionId);
  const ledgerPath = join(directory, "ledger.jsonl");
  const blobs = await openBlobStore(join(directory, "blobs"));
  const ledger: Ledger = await openLedger({
    path: ledgerPath,
    now: options.now,
    ...(options.ledgerWrite === undefined ? {} : { write: options.ledgerWrite }),
  });
  return {
    sessionId: options.sessionId,
    directory,
    ledgerPath,
    blobs,
    async record(entry: EvidenceEntry): Promise<RecordedEvidence> {
      const scrubbed = scrubJson(entry.payload);
      const payloadDigest = await blobs.put(scrubbed.value);
      const record = await ledger.append({
        type: entry.type,
        actor: entry.actor,
        payloadDigest,
        provenance: entry.provenance,
      });
      return { record, redactions: scrubbed.redactions };
    },
    head: () => ledger.head(),
    records: () => ledger.records(),
  };
}
