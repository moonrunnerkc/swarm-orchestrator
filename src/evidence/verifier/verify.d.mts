// Types for the embedded verifier. The script itself stays plain JavaScript with no
// imports outside node: builtins, because it ships inside every bundle and has to run
// where this package is not installed. These declarations exist so the parity test can
// hold the two implementations to the same contract.

import type { JsonValue } from "../canonical-json.ts";
import type { CitedRecord, ClaimEvaluation, ClaimPayload, EvidenceLookup } from "../claim.ts";
import type { LedgerRecord, RecordType } from "../ledger-record.ts";
import type { PredicateNode, PredicateResult } from "../predicate.ts";

export declare function canonicalJson(value: JsonValue): string;
export declare function sha256(bytes: string): string;
export declare function parsePredicate(source: string): PredicateNode;
export declare function evaluatePredicate(node: PredicateNode, subject: JsonValue): PredicateResult;
export declare function recordKindOf(type: RecordType, payload: JsonValue | undefined): string;
export declare function indexCitedRecords(
  records: readonly Pick<LedgerRecord, "type" | "payloadDigest">[],
  payloads: ReadonlyMap<string, JsonValue>,
): ReadonlyMap<string, CitedRecord>;
export declare function evaluateClaim(claim: ClaimPayload, lookup: EvidenceLookup): ClaimEvaluation;
/** Returns the process exit code: 0 when every check passed. */
export declare function verifyBundle(directory: string): number;

export type BondVerdict = "held" | "vacuous" | "unshown" | "not-measured";
export declare function bondVerdict(input: {
  readonly observed: "passed" | "failed" | "not-applicable";
  readonly provable: boolean;
  readonly collectedBefore: number | null;
  readonly collectedAfter: number | null;
}): BondVerdict;
export declare function recomputeBondVerdict(
  payload: JsonValue | undefined,
): BondVerdict | "not-bonded";
export declare function sealConformance(
  records: readonly Pick<LedgerRecord, "type" | "sequence" | "payloadDigest">[],
  payloads: ReadonlyMap<string, JsonValue>,
): {
  readonly sealed: { readonly sequence: number; readonly gates: number } | null;
  readonly problems: readonly string[];
};
