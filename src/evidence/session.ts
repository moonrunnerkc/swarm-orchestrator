import { join } from "node:path";
import type { Clock } from "../core/clock.ts";
import type { ProvenanceTag } from "../core/model-client.ts";
import type { RandomSource } from "../core/random-source.ts";
import { type BlobStore, openBlobStore } from "./blob-store.ts";
import type { JsonValue } from "./canonical-json.ts";
import { type ClaimEvaluation, type ClaimPayload, evaluateClaim } from "./claim.ts";
import { type ChainHead, type Ledger, openLedger } from "./ledger.ts";
import type { LedgerRecord, RecordType } from "./ledger-record.ts";
import { scrubJson } from "./scrub.ts";

interface EvidenceEntry {
  readonly type: RecordType;
  readonly actor: string;
  readonly provenance: readonly ProvenanceTag[];
  readonly payload: JsonValue;
  readonly promptDigest?: string;
  readonly responseDigest?: string;
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
  /**
   * Records the assertion, then evaluates it against the chain. The returned verdict is
   * the harness's, computed after the fact; the caller cannot supply one.
   */
  submitClaim(claim: ClaimPayload, actor: string): Promise<ClaimEvaluation>;
  head(): ChainHead;
  records(): readonly LedgerRecord[];
  payloads(): ReadonlyMap<string, JsonValue>;
}

interface EvidenceSessionOptions {
  /** The session store root, outside the workspace and denied to tools (invariant 11). */
  readonly root: string;
  readonly sessionId: string;
  readonly clock: Clock;
  readonly ledgerWrite?: (path: string, line: string) => Promise<void>;
}

export function defaultSessionRoot(homeDirectory: string): string {
  return join(homeDirectory, ".swarm", "sessions");
}

export function createSessionId(clock: Clock, random: RandomSource): string {
  const stamp = new Date(clock.now()).toISOString().replace(/[-:]/g, "").slice(0, 15);
  const suffix = Math.floor(random.next() * 0xff_ff_ff)
    .toString(16)
    .padStart(6, "0");
  return `${stamp}-${suffix}`;
}

function sessionDirectory(root: string, sessionId: string): string {
  return join(root, sessionId);
}

/**
 * Opens the ledger and blob store for one session. Payloads are scrubbed on the way in,
 * before anything reaches disk, because a blob directory that has been copied or backed up
 * cannot be un-leaked at export time (invariant 9).
 */
export async function openEvidenceSession(
  options: EvidenceSessionOptions,
): Promise<EvidenceRecorder> {
  const directory = sessionDirectory(options.root, options.sessionId);
  const ledgerPath = join(directory, "ledger.jsonl");
  const blobs = await openBlobStore(join(directory, "blobs"));
  const ledger: Ledger = await openLedger({
    path: ledgerPath,
    clock: options.clock,
    ...(options.ledgerWrite === undefined ? {} : { write: options.ledgerWrite }),
  });

  const payloads = new Map<string, JsonValue>();

  const record = async (entry: EvidenceEntry): Promise<RecordedEvidence> => {
    const scrubbed = scrubJson(entry.payload);
    const payloadDigest = await blobs.put(scrubbed.value);
    payloads.set(payloadDigest, scrubbed.value);

    const appended = await ledger.append({
      type: entry.type,
      actor: entry.actor,
      payloadDigest,
      provenance: entry.provenance,
      ...(entry.promptDigest === undefined ? {} : { promptDigest: entry.promptDigest }),
      ...(entry.responseDigest === undefined ? {} : { responseDigest: entry.responseDigest }),
    });

    return { record: appended, redactions: scrubbed.redactions };
  };

  return {
    sessionId: options.sessionId,
    directory,
    ledgerPath,
    blobs,
    record,

    async submitClaim(claim: ClaimPayload, actor: string): Promise<ClaimEvaluation> {
      await record({
        type: "claim",
        actor,
        provenance: ["model"],
        payload: { predicate: claim.predicate, record: claim.record, narrative: claim.narrative },
      });
      const citable = new Set(ledger.records().map((entry) => entry.payloadDigest));
      return evaluateClaim(claim, (digest) =>
        citable.has(digest) ? payloads.get(digest) : undefined,
      );
    },

    head: () => ledger.head(),
    records: () => ledger.records(),
    payloads: () => payloads,
  };
}
