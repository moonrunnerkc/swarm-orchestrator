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
 * binding check rests on.
 *
 * So the index keeps every record that carries the digest, each with the sequence that names
 * it on the chain, and leaves the choice between them to the claim. A claim carries the
 * sequence the harness bound it to when it was submitted, which is what stops a record
 * appended afterwards from reaching back and changing an earlier verdict; a digest that
 * already named more than one kind at submission is bound to nothing at all, and the claim
 * citing it renders UNVERIFIED with the collision named. Fail-closed on a real ambiguity,
 * and untouched by an ambiguity that did not exist yet.
 */

/** The fields of a ledger record this index needs, so the ledger and a bundle both fit. */
interface IndexableRecord {
  readonly sequence: number;
  readonly type: RecordType;
  readonly payloadDigest: string;
}

export function indexCitedRecords(
  records: readonly IndexableRecord[],
  payloads: ReadonlyMap<string, JsonValue>,
): ReadonlyMap<string, CitedRecord> {
  const index = new Map<
    string,
    { carriers: { sequence: number; kind: string }[]; payload: JsonValue }
  >();

  for (const record of records) {
    const payload = payloads.get(record.payloadDigest);
    if (payload === undefined) {
      continue;
    }
    const carrier = { sequence: record.sequence, kind: recordKindOf(record.type, payload) };
    const found = index.get(record.payloadDigest);
    if (found === undefined) {
      index.set(record.payloadDigest, { carriers: [carrier], payload });
      continue;
    }
    // Chain order, every carrier kept: the record that bound this content into the chain
    // stays first, and a claim that named one of them by sequence still finds it.
    found.carriers.push(carrier);
  }

  return new Map([...index].map(([digest, entry]) => [digest, entry as CitedRecord]));
}
