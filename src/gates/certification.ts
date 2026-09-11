import type { OracleBondVerdict } from "./oracle-bond.ts";

/**
 * Whether a vacuous oracle bond refuses to certify.
 *
 * The one place the decision lives, so reverting the commit that set this true restores
 * report-only and nothing else moves with it.
 *
 * Reach cost three artifacts, a closing brace, a changelog and a declaration file, before it was
 * safe to refuse on, and each of them turned a correct patch into a refusal. Bonding was held to
 * the same audit before this became true: every vacuous verdict across the sixteen certified
 * patches read by hand. Two were mutants that changed nothing, `return false;` replaced by
 * `return undefined;` inside a filter predicate and a swapped `Math.min`, and both narrowed the
 * operator that produced them rather than excusing the patch. Re-measured after that, one vacuous
 * verdict stands, on the one false green the corpus still holds, and its mutant inverts a merge
 * order the oracle runs and never tests.
 *
 * Only `vacuous` is ever a candidate. `unshown` and `not-bonded` are absences of evidence about
 * the oracle rather than evidence against it, and refusing on them would make the certify rate a
 * function of how many mutation operators this build carries.
 */
export const bondRefusesCertification: boolean = true;

export interface RecordedVerdict {
  readonly certificationPolicy?: "oracle-v3" | "required-obligations-v1";
  readonly acceptance?: import("./contract-verification.ts").ContractVerification;
  readonly regression: "pass" | "fail" | "unmeasured";
  readonly task: "accepted" | "rejected" | "unjudged" | "vacuous";
  readonly oracleReach: "reached" | "unreached" | "unmeasured";
  readonly oracleBond: OracleBondVerdict;
}

export type RefusalReason =
  | "required-obligations-not-accepted"
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
  if (verdict.certificationPolicy === "required-obligations-v1") {
    const obligations = verdict.acceptance?.obligations;
    if (
      obligations === undefined ||
      obligations.length === 0 ||
      !obligations.every(
        (entry) =>
          entry.severity === "advisory" ||
          entry.status === "accepted" ||
          entry.status === "not-applicable",
      )
    )
      reasons.push("required-obligations-not-accepted");
    return reasons;
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
