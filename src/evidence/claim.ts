import { z } from "zod";
import type { JsonValue } from "./canonical-json.ts";
import { digestPattern } from "./canonical-json.ts";
import { evaluatePredicate, PredicateParseError, parsePredicate } from "./predicate.ts";

/**
 * What the model may assert. The predicate, the cited record, and the kind of record the
 * claim is about are the model's choice; the verdict is not. Narrative is free text and is
 * displayed as unverified prose regardless of what it says (invariant 1).
 */
export const claimPayloadSchema = z.object({
  predicate: z.string().min(1),
  record: z.string().regex(digestPattern).nullable(),
  /**
   * The kind of record this claim asserts against, as `recordKindOf` computes it. Declaring
   * it is what makes the binding checkable: without it a predicate that happens to be true of
   * some other record renders green, and "the tests gate passed" is backed by the lint run.
   */
  recordKind: z.string().min(1),
  /**
   * Which record on the chain the harness resolved the citation to when the claim was
   * submitted. The harness writes it, never the model. Null means the harness refused to
   * bind: the digest already named more than one record, and an edge that cannot be traced
   * to one record backs no claim. Absent means the claim was evaluated without ever being
   * submitted, in which case the citation is read as the record that first carried it, since
   * that is the record the digest entered the chain against.
   */
  recordSequence: z.number().int().nonnegative().nullable().optional(),
  narrative: z.string(),
});

export type ClaimPayload = z.infer<typeof claimPayloadSchema>;

type ClaimVerdict = "verified" | "unverified";

type UnverifiedReason =
  | "no-evidence-edge"
  | "record-not-found"
  | "predicate-kind-mismatch"
  | "predicate-unparseable"
  | "path-not-found"
  | "type-mismatch"
  | "predicate-false";

export interface ClaimEvaluation {
  readonly verdict: ClaimVerdict;
  /** Null exactly when the verdict is verified. */
  readonly reason: UnverifiedReason | null;
  readonly detail: string;
}

/**
 * What one cited payload digest resolves to: the content every record carrying it holds, and
 * the records that carry it, each named by its sequence on the chain. More than one kind
 * among them means the digest identifies no single record, which is a state a verdict has to
 * see rather than a tie to be broken. See record-index.ts, which is the one place this is
 * built.
 */
export interface CitedRecord {
  readonly carriers: readonly CitedCarrier[];
  readonly payload: JsonValue;
}

/** One record carrying a cited digest: where it sits on the chain, and what kind it is. */
export interface CitedCarrier {
  readonly sequence: number;
  readonly kind: string;
}

/** Resolves a cited digest to the ledger records that carry it. */
export type EvidenceLookup = (digest: string) => CitedRecord | undefined;

/**
 * The only place a green verdict is produced anywhere in the system. Every failure mode
 * is a display state, never an exception: a run does not abort because a claim was wrong
 * or malformed, it just fails to render green.
 */
export function evaluateClaim(claim: ClaimPayload, lookup: EvidenceLookup): ClaimEvaluation {
  if (claim.record === null) {
    return {
      verdict: "unverified",
      reason: "no-evidence-edge",
      detail: "the claim cites no record, so there is nothing to check it against",
    };
  }

  const cited = lookup(claim.record);
  if (cited === undefined) {
    return {
      verdict: "unverified",
      reason: "record-not-found",
      detail: `no ledger record carries the payload digest ${claim.record}`,
    };
  }

  // Before the predicate, because a predicate that is true of the wrong kind of record is
  // exactly the case a verdict of "false" would misreport as an honest near miss. The claim
  // is checked against the one record it was bound to, and nothing appended afterwards moves
  // that binding: a later writer reusing this digest under another kind is a fact about the
  // later writer, not a reason to withdraw a verdict that was honestly earned.
  const kinds = [...new Set(cited.carriers.map((carrier) => carrier.kind))];
  if (claim.recordSequence === null) {
    return {
      verdict: "unverified",
      reason: "predicate-kind-mismatch",
      detail:
        kinds.length > 1
          ? `the digest ${claim.record} is carried by records of ${kinds.length} kinds ` +
            `(${kinds.join(", ")}), so it named no single record when this claim was submitted ` +
            `and the claim's binding to ${claim.recordKind} cannot be checked.`
          : "the harness bound this claim to no record when it was submitted, so there is " +
            "nothing to check the predicate against.",
    };
  }

  const bound =
    claim.recordSequence === undefined
      ? cited.carriers[0]
      : cited.carriers.find((carrier) => carrier.sequence === claim.recordSequence);
  if (bound === undefined) {
    return {
      verdict: "unverified",
      reason: "record-not-found",
      detail:
        `no record at sequence ${claim.recordSequence} carries the payload digest ` +
        `${claim.record}, so the record this claim was bound to is not on the chain`,
    };
  }

  const actualKind = bound.kind;
  if (actualKind !== claim.recordKind) {
    return {
      verdict: "unverified",
      reason: "predicate-kind-mismatch",
      detail:
        `the claim asserts against ${claim.recordKind}, but the cited record is ` +
        `${actualKind}. A predicate holding against a record of another kind is not ` +
        "evidence for this claim.",
    };
  }

  let node: ReturnType<typeof parsePredicate>;
  try {
    node = parsePredicate(claim.predicate);
  } catch (cause) {
    return {
      verdict: "unverified",
      reason: "predicate-unparseable",
      detail:
        cause instanceof PredicateParseError ? cause.message : `the predicate could not be parsed`,
    };
  }

  const result = evaluatePredicate(node, cited.payload);
  if (!result.ok) {
    return { verdict: "unverified", reason: result.failure, detail: result.detail };
  }
  if (!result.value) {
    return {
      verdict: "unverified",
      reason: "predicate-false",
      detail: "the cited record does not support the predicate",
    };
  }

  return {
    verdict: "verified",
    reason: null,
    detail: `the harness evaluated the predicate against the cited ${actualKind} record and it held`,
  };
}

export function describeEvaluation(evaluation: ClaimEvaluation): string {
  if (evaluation.verdict === "verified") {
    return "VERIFIED";
  }
  return `UNVERIFIED (${evaluation.reason ?? "unknown"})`;
}
