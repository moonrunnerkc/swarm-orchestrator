import { z } from "zod";
import type { JsonValue } from "./canonical-json.ts";
import { digestPattern } from "./canonical-json.ts";
import { evaluatePredicate, PredicateParseError, parsePredicate } from "./predicate.ts";

/**
 * What the model may assert. The predicate and the cited record are the model's choice;
 * the verdict is not. Narrative is free text and is displayed as unverified prose
 * regardless of what it says (invariant 1).
 */
export const claimPayloadSchema = z.object({
  predicate: z.string().min(1),
  record: z.string().regex(digestPattern).nullable(),
  narrative: z.string(),
});

export type ClaimPayload = z.infer<typeof claimPayloadSchema>;

export type ClaimVerdict = "verified" | "unverified";

export type UnverifiedReason =
  | "no-evidence-edge"
  | "record-not-found"
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

/** Resolves a cited digest to the payload of the ledger record that carries it. */
export type EvidenceLookup = (digest: string) => JsonValue | undefined;

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

  const payload = lookup(claim.record);
  if (payload === undefined) {
    return {
      verdict: "unverified",
      reason: "record-not-found",
      detail: `no ledger record carries the payload digest ${claim.record}`,
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

  const result = evaluatePredicate(node, payload);
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
    detail: "the harness evaluated the predicate against the cited record and it held",
  };
}

export function describeEvaluation(evaluation: ClaimEvaluation): string {
  if (evaluation.verdict === "verified") {
    return "VERIFIED";
  }
  return `UNVERIFIED (${evaluation.reason ?? "unknown"})`;
}
