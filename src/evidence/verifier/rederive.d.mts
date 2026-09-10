// Types for the embedded re-derivation script, for the same reason verify.d.mts exists: the
// script is plain JavaScript that ships inside every bundle, and these let the parity tests
// hold it to the parser and ratchet rules in this tree.

import type { GateObservation } from "../../gates/gate-definition.ts";
import type { JsonValue } from "../canonical-json.ts";

export type ParserRule = "exit-code" | "no-output" | "test-output" | "inspection";
export type DerivedStatus = "passed" | "failed" | "not-applicable";

/** Null where the rule is not one the script knows, rather than a guess. */
export declare function readStatus(
  parser: string,
  observation: Pick<GateObservation, "exitCode" | "stdout" | "stderr"> & Partial<GateObservation>,
): DerivedStatus | null;
export declare function rederiveRatchet(payload: JsonValue): {
  readonly violations: readonly string[];
  readonly skipped: readonly string[];
};
/** Returns the process exit code: 0 when every re-derived verdict agrees. */
export declare function rederiveBundle(directory: string, log?: (line: string) => void): number;

/** Mirrors `bondRefusesCertification` in ../../gates/certification.ts; a parity test holds them. */
export declare const bondRefusesCertification: boolean;
/** Mirrors `reasonsToRefuse` in ../../gates/certification.ts. */
export declare function refusalsToCertify(verdict: {
  readonly regression?: string;
  readonly task?: string;
  readonly oracleReach?: string;
  readonly oracleBond?: string;
}): readonly string[];
/**
 * The verdict a recorded `swarm ci` result implies. `rederived` is false, and `verified` null,
 * where a field the policy reads is absent or carries a word the policy does not know.
 */
export declare function rederiveCiVerdict(verdict: {
  readonly regression?: string;
  readonly task?: string;
  readonly oracleReach?: string;
  readonly oracleBond?: string;
}): {
  readonly rederived: boolean;
  readonly missing: readonly string[];
  readonly reasons: readonly string[];
  readonly verified: boolean | null;
};
/**
 * The bond a row's own mutants imply, so the measurement is checkable and not only the verdict
 * that reads it. Worst finding first: one mutant the oracle accepted on a line it ran outranks
 * every refusal, a refusal outranks an absence of evidence, and no mutant means nothing was asked.
 */
export declare function rederiveOracleBond(
  mutants:
    | readonly {
        readonly verdict?: string;
      }[]
    | undefined,
): string;
