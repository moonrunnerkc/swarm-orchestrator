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
