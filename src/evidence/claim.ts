import { z } from "zod";
import type { JsonValue } from "./canonical-json.ts";
import { digestPattern } from "./canonical-json.ts";
import type { RecordType } from "./ledger-record.ts";
import { evaluatePredicate, PredicateParseError, parsePredicate } from "./predicate.ts";
import { recordKindOf } from "./record-kind.ts";

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

/** One ledger record as the harness reads it back: what kind of thing it is, and what it says. */
export interface CitedRecord {
  readonly type: RecordType;
  readonly payload: JsonValue;
}

/** Resolves a cited digest to the ledger record that carries it. */
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
  // exactly the case a verdict of "false" would misreport as an honest near miss.
  const actualKind = recordKindOf(cited.type, cited.payload);
  if (actualKind !== claim.recordKind) {
    return {
      verdict: "unverified",
      reason: "predicate-kind-mismatch",
      detail:
        `the claim asserts against ${claim.recordKind}, but the cited record is ${actualKind}. ` +
        "A predicate holding against a record of another kind is not evidence for this claim.",
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
