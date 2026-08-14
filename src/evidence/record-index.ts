import type { JsonValue } from "./canonical-json.ts";
import type { CitedRecord } from "./claim.ts";
import type { RecordType } from "./ledger-record.ts";
import { recordKindOf } from "./record-kind.ts";

/**
 * What a cited payload digest resolves to. Content addressing means identical content is one
 * blob, which is correct and is the point of it; what must not follow is that the record a
 * claim resolves to is whatever wrote that blob last.
 *
 * Two writers emitting byte-identical payloads collide, and before this the later one
 * silently redefined the citation: a gate-run written after a tool-call with the same payload
 * made a `gate-run:tests` claim resolve to the gate-run, and a claim written between them
 * resolved to something else entirely. The payload cannot differ between colliding records,
 * since the digest is over the payload. The kind can, and the kind is what invariant 1's
 * binding check rests on, so it is what this index keeps.
 *
 * A digest carried by records of more than one kind names none of them, and the claim that
 * cites it renders UNVERIFIED with the collision in its detail rather than resolving to a
 * winner. Fail-closed on purpose: the alternative is a verdict a reviewer cannot trace back
 * to one record.
 */

/** The fields of a ledger record this index needs, so the ledger and a bundle both fit. */
interface IndexableRecord {
  readonly type: RecordType;
  readonly payloadDigest: string;
}

export function indexCitedRecords(
  records: readonly IndexableRecord[],
  payloads: ReadonlyMap<string, JsonValue>,
): ReadonlyMap<string, CitedRecord> {
  const index = new Map<string, { kinds: string[]; payload: JsonValue }>();

  for (const record of records) {
    const payload = payloads.get(record.payloadDigest);
    if (payload === undefined) {
      continue;
    }
    const kind = recordKindOf(record.type, payload);
    const found = index.get(record.payloadDigest);
    if (found === undefined) {
      index.set(record.payloadDigest, { kinds: [kind], payload });
      continue;
    }
    // Chain order, first occurrence kept: the record that bound this content into the chain
    // stays first however many later ones repeat it.
    if (!found.kinds.includes(kind)) {
      found.kinds.push(kind);
    }
  }

  return new Map([...index].map(([digest, entry]) => [digest, entry as CitedRecord]));
}
