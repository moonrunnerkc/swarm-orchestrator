import type { OracleBondVerdict } from "./oracle-bond.ts";

/**
 * Whether a vacuous oracle bond refuses to certify.
 *
 * The one place the decision lives, so turning it on is this line and the evidence behind it.
 * Reach cost three artifacts, a closing brace, a changelog and a declaration file, before it was
 * safe to refuse on, and each of them turned a correct patch into a refusal. Bonding is held to
 * the same audit: every vacuous verdict read by hand across the certified corpus, zero of them a
 * mutant that changes nothing, before this becomes true.
 *
 * Only `vacuous` is ever a candidate. `unshown` and `not-bonded` are absences of evidence about
 * the oracle rather than evidence against it, and refusing on them would make the certify rate a
 * function of how many mutation operators this build carries.
 */
export const bondRefusesCertification: boolean = false;

export interface RecordedVerdict {
  readonly regression: "pass" | "fail" | "unmeasured";
  readonly task: "accepted" | "rejected" | "unjudged" | "vacuous";
  readonly oracleReach: "reached" | "unreached" | "unmeasured";
  readonly oracleBond: OracleBondVerdict;
}

export type RefusalReason =
  | "regression-not-pass"
  | "task-not-accepted"
  | "oracle-did-not-reach-the-change"
  | "oracle-bond-vacuous";

/**
 * Every reason the record itself holds for not certifying, named.
 *
 * `verified` is the absence of these and nothing else, which is what lets a third party re-derive
 * the verdict from the record instead of trusting the run that wrote it. Every reason here reads
 * one recorded field, so a bundle carrying the fields carries the verdict.
 */
export function reasonsToRefuse(verdict: RecordedVerdict): readonly RefusalReason[] {
  const reasons: RefusalReason[] = [];
  if (verdict.regression !== "pass") {
    reasons.push("regression-not-pass");
  }
  if (verdict.task !== "accepted") {
    reasons.push("task-not-accepted");
  }
  if (verdict.oracleReach === "unreached") {
    reasons.push("oracle-did-not-reach-the-change");
  }
  if (bondRefusesCertification && verdict.oracleBond === "vacuous") {
    reasons.push("oracle-bond-vacuous");
  }
  return reasons;
}

export function certifies(verdict: RecordedVerdict): boolean {
  return reasonsToRefuse(verdict).length === 0;
}
