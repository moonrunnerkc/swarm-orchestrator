// Types for the embedded verifier. The script itself stays plain JavaScript with no
// imports outside node: builtins, because it ships inside every bundle and has to run
// where this package is not installed. These declarations exist so the parity test can
// hold the two implementations to the same contract.

import type { JsonValue } from "../canonical-json.ts";
import type { ClaimEvaluation, ClaimPayload, EvidenceLookup } from "../claim.ts";
import type { PredicateNode, PredicateResult } from "../predicate.ts";

export declare function canonicalJson(value: JsonValue): string;
export declare function sha256(bytes: string): string;
export declare function parsePredicate(source: string): PredicateNode;
export declare function evaluatePredicate(node: PredicateNode, subject: JsonValue): PredicateResult;
export declare function evaluateClaim(claim: ClaimPayload, lookup: EvidenceLookup): ClaimEvaluation;
/** Returns the process exit code: 0 when every check passed. */
export declare function verifyBundle(directory: string): number;
