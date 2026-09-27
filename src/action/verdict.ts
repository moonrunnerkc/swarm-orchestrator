import { z } from "zod";
import { asJsonValue, canonicalJson, digestOfJson } from "../evidence/canonical-json.ts";

/**
 * The one document the Action signs. It binds the repository, the pull request, the exact
 * head, base and tree, the verifier and its policy, the run that produced it, the digests of
 * the evidence it produced, and the decision. It is canonical JSON, so the digest a signer
 * binds is the digest a reader recomputes; and it is signed by an established mechanism
 * (GitHub artifact attestations over Sigstore), never by anything this module invents.
 *
 * What a signature over it establishes is that this document was produced by the named
 * workflow in the named repository on the named run. It does not establish that the decision
 * is right: the decision was computed from the evidence the digests name, and that evidence
 * verifies on its own.
 */
export const verdictSchemaName = "swarm-verify.verdict.v1";

/** The predicate type a reader names to `gh attestation verify --predicate-type`. */
export const verdictPredicateType = "https://github.com/moonrunnerkc/swarm-verify/verdict/v1";

export const verdictSchema = z.strictObject({
  schema: z.literal(verdictSchemaName),
  repository: z.string().min(1),
  pullRequest: z.number().int().positive().nullable(),
  target: z.enum(["head", "merge"]),
  /** The commit that was verified: the PR head, or GitHub's test merge of it. */
  head: z.string().regex(/^[0-9a-f]{40}$/),
  /** The PR head as the event named it, which under `merge` differs from `head`. */
  eventHead: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .nullable(),
  base: z.string().regex(/^[0-9a-f]{40}$/),
  comparisonBase: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .nullable(),
  tree: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .nullable(),
  patchDigest: z.string().nullable(),
  verifier: z.strictObject({ name: z.literal("swarm-verify"), version: z.string().min(1) }),
  policy: z.strictObject({
    isolation: z.enum(["docker", "host"]),
    image: z.string().nullable(),
    goalContractDigest: z.string().nullable(),
    oracle: z.string().nullable(),
    packages: z.array(z.string()),
    install: z.boolean(),
    /** Whether a regression-only pass counts as a failure for this consumer. */
    requireTask: z.boolean(),
  }),
  execution: z.strictObject({
    eventName: z.string(),
    runId: z.string(),
    runAttempt: z.string(),
    workflowRef: z.string(),
    runnerEnvironment: z.string(),
    executionTrust: z.string(),
  }),
  evidence: z.strictObject({
    reportDigest: z.string().nullable(),
    summaryDigest: z.string().nullable(),
    assessmentDigest: z.string().nullable(),
    bundleChainHead: z.string().nullable(),
  }),
  decision: z.strictObject({
    /** What the Action returns: 0 verified or regression-only, 1 not verified, 4 otherwise. */
    status: z.number().int(),
    /** What the verifier itself exited, which refuses an unjudged task with 1. */
    verifierStatus: z.number().int().nullable(),
    result: z.enum([
      "verified",
      "regression-only",
      "not-verified",
      "incomplete",
      "head-changed",
      "refused",
    ]),
    regression: z.string().nullable(),
    task: z.string().nullable(),
    unmeasured: z.array(z.string()),
    reason: z.string().nullable(),
  }),
});

export type Verdict = z.infer<typeof verdictSchema>;

/** Validate, then render the bytes a signer binds and a reader digests. */
export function canonicalVerdict(verdict: Verdict): {
  readonly bytes: string;
  readonly digest: string;
} {
  const parsed = verdictSchema.parse(verdict);
  const value = asJsonValue(parsed);
  return { bytes: `${canonicalJson(value)}\n`, digest: digestOfJson(value) };
}
