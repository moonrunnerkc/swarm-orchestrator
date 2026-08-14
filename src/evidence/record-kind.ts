import type { JsonValue } from "./canonical-json.ts";
import type { RecordType } from "./ledger-record.ts";

/**
 * What a claim is allowed to assert against (invariant 1). The record type on its own is not
 * enough wherever one type covers many subjects: every gate writes a gate-run and every tool
 * writes a tool-call, so `status == "passed"` is equally true of the lint run and the tests
 * run, and a claim bound to the wrong one of them is the fabrication surface the evidence DAG
 * exists to close. The kind names the subject, so the binding is checkable rather than
 * plausible.
 *
 * Data, not branching: adding a record type that needs a subject is a line in this table.
 */
const subjectFieldByType: Partial<Record<RecordType, string>> = {
  "gate-run": "gateId",
  "tool-call": "toolName",
};

/**
 * The kind of one record, computed from the record itself. A payload that carries no subject
 * where one was expected falls back to the bare type rather than inventing a name, so a claim
 * can still bind to it honestly.
 */
export function recordKindOf(type: RecordType, payload: JsonValue | undefined): string {
  const field = subjectFieldByType[type];
  if (field === undefined) {
    return type;
  }
  if (payload === null || payload === undefined || typeof payload !== "object") {
    return type;
  }
  const subject = (payload as { readonly [key: string]: JsonValue })[field];
  return typeof subject === "string" && subject.length > 0 ? `${type}:${subject}` : type;
}
