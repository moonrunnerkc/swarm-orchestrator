import { z } from "zod";
import { digestOfJson } from "../evidence/canonical-json.ts";

const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const observation = z.object({
  status: z.enum(["passed", "assertion-failed", "load-error", "timeout", "unavailable"]),
  evidenceDigest: digest,
});
export const oracleChallengeSchema = z.object({
  version: z.literal(1),
  repository: z.string().min(1),
  baseCommit: z.string().min(1),
  author: z.string().min(1),
  exposure: z.enum(["development", "held-out"]),
  oracle: z.object({ artifactDigest: digest, argv: z.array(z.string()).min(1) }),
  heldBack: z.object({ artifactDigest: digest, argv: z.array(z.string()).min(1) }),
  referencePatch: digest,
  counterexamplePatch: digest,
  reference: z.object({ regression: observation, supplied: observation, heldBack: observation }),
  counterexample: z.object({
    regression: observation,
    supplied: observation,
    heldBack: observation,
  }),
});

export function admitOracleChallenge(input: unknown) {
  const challenge = oracleChallengeSchema.parse(input);
  const referenceAccepted = Object.values(challenge.reference).every(
    (entry) => entry.status === "passed",
  );
  if (
    !referenceAccepted ||
    challenge.counterexample.regression.status !== "passed" ||
    challenge.counterexample.supplied.status !== "passed" ||
    challenge.counterexample.heldBack.status !== "assertion-failed"
  ) {
    throw new Error(
      "challenge admission requires an accepted reference and an executed counterexample assertion failure; unavailable instruments cannot establish inadequacy",
    );
  }
  return {
    challenge,
    challengeId: digestOfJson(challenge),
    oracleId: digestOfJson({
      repository: challenge.repository,
      baseCommit: challenge.baseCommit,
      oracle: challenge.oracle,
    }),
  };
}

export function freezeChallengeRegistry(inputs: readonly unknown[]) {
  const admitted = inputs.map(admitOracleChallenge);
  if (new Set(admitted.map((entry) => entry.oracleId)).size !== admitted.length)
    throw new Error("duplicate oracle identity in primary challenge registry");
  return { entries: admitted, digest: digestOfJson(admitted) };
}

/** The admitted population is fixed before the verifier sees either patch. */
export function gradeChallengeRegistry(
  inputs: readonly unknown[],
  observations: readonly unknown[],
) {
  const registry = freezeChallengeRegistry(inputs);
  const rows = z
    .array(
      z.object({
        oracleId: digest,
        reference: z.enum(["accepted", "refused", "unavailable"]),
        counterexample: z.enum(["accepted", "refused", "unavailable"]),
        evidenceDigest: digest,
      }),
    )
    .parse(observations);
  const identities = new Set(registry.entries.map((entry) => entry.oracleId));
  if (
    new Set(rows.map((row) => row.oracleId)).size !== rows.length ||
    rows.some((row) => !identities.has(row.oracleId))
  )
    throw new Error("challenge grading contains a duplicate or unadmitted oracle identity");
  const missing = registry.entries
    .filter((entry) => !rows.some((row) => row.oracleId === entry.oracleId))
    .map((entry) => entry.oracleId);
  return {
    registryDigest: registry.digest,
    admitted: identities.size,
    observed: rows.length,
    missing,
    validPatchAccepted: rows.filter((row) => row.reference === "accepted").length,
    counterexampleRefused: rows.filter((row) => row.counterexample === "refused").length,
    bothCorrect: rows.filter(
      (row) => row.reference === "accepted" && row.counterexample === "refused",
    ).length,
    unavailable: rows.filter(
      (row) => row.reference === "unavailable" || row.counterexample === "unavailable",
    ).length,
    rows,
  };
}
