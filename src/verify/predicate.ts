import { z } from "zod";
import { protectedCategories } from "../config/swarm-toml.ts";
import { statementType } from "./dsse.ts";

export const predicateType = "https://swarm-verify.dev/verdict/v1";

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const rate = z.number().min(0).max(1);
const unmeasured = z.object({ status: z.literal("unmeasured"), reason: z.string().min(1) });

export const checkResultSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  kind: z.enum(["test", "other"]),
  // pre-existing-failure: failed at the base commit and still fails, so it measures nothing here.
  result: z.enum(["pass", "fail", "error", "pre-existing-failure"]),
  exitCode: z.number().int().nullable(),
  durationMs: z.number().int().nonnegative(),
  outputSha256: sha256,
  baseOutputSha256: sha256.optional(),
});
export type CheckResult = z.infer<typeof checkResultSchema>;

const finding = z.object({ path: z.string().min(1), category: z.enum(protectedCategories) });

export const coverageSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("measured"),
    tool: z.enum(["v8", "coverage.py"]),
    changedLines: z.number().int().nonnegative(),
    coveredLines: z.number().int().nonnegative(),
    files: z.array(
      z.object({ path: z.string(), covered: z.array(z.number()), uncovered: z.array(z.number()) }),
    ),
  }),
  unmeasured,
]);
export type Coverage = z.infer<typeof coverageSchema>;

export const mutationSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.enum(["killed", "survived"]),
    path: z.string(),
    line: z.number().int().positive(),
    operator: z.string(),
  }),
  unmeasured,
]);
export type Mutation = z.infer<typeof mutationSchema>;

export const heldOutSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("measured"),
    checks: z.array(checkResultSchema),
    visiblePassRate: rate,
    heldOutPassRate: rate,
    gap: z.number().min(-1).max(1),
    /** Processes that loaded the judge, and the node:assert calls they made. */
    judge: z.object({
      processes: z.number().int().nonnegative(),
      assertionCalls: z.number().int().nonnegative(),
    }),
  }),
  unmeasured,
]);
export type HeldOut = z.infer<typeof heldOutSchema>;

/** Every declared and held-out check, run at the base commit before the change applied. */
export const baselineSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("measured"),
    /** Reused from an earlier run with the same base, environment, sealed set and judge. */
    cached: z.boolean(),
    environmentSha256: sha256,
    checks: z.array(checkResultSchema),
    heldOut: z.array(checkResultSchema),
  }),
  unmeasured,
]);
export type Baseline = z.infer<typeof baselineSchema>;

export const predicateSchema = z.object({
  verdict: z.enum(["pass", "fail", "unmeasured"]),
  reasons: z.array(z.string()),
  base: z.object({ commit: z.string().min(1) }),
  change: z.object({
    source: z.enum(["working-tree", "range", "patch"]),
    applied: z.boolean(),
    files: z.array(
      z.object({ path: z.string(), status: z.enum(["added", "modified", "deleted"]) }),
    ),
  }),
  checks: z.array(checkResultSchema),
  baseline: baselineSchema,
  heldOut: heldOutSchema,
  protectedPaths: z.object({
    changed: z.array(finding),
    violations: z.array(finding),
    allowed: z.array(z.enum(protectedCategories)),
  }),
  coverage: coverageSchema,
  mutation: mutationSchema,
  producer: z.object({ model: z.string().optional(), promptSha256: sha256.optional() }),
  environment: z.object({
    sha256,
    node: z.string(),
    platform: z.string(),
    git: z.string(),
    dependencies: z.enum(["linked", "setup", "none"]),
  }),
  unmeasured: z.array(z.string()),
  verifier: z.object({ name: z.literal("swarm-verify"), version: z.string() }),
});
export type Predicate = z.infer<typeof predicateSchema>;

export const statementSchema = z.object({
  _type: z.literal(statementType),
  subject: z.array(z.object({ name: z.string().min(1), digest: z.object({ sha256 }) })).min(1),
  predicateType: z.literal(predicateType),
  predicate: predicateSchema,
});
export type Statement = z.infer<typeof statementSchema>;

/** Subjects: the resulting tree, and the patch that produced it from the base. */
export function buildStatement(input: {
  readonly treeSha256: string;
  readonly patchSha256: string;
  readonly patchName: string;
  readonly predicate: Predicate;
}): Statement {
  return statementSchema.parse({
    _type: statementType,
    subject: [
      { name: "tree", digest: { sha256: input.treeSha256 } },
      { name: input.patchName, digest: { sha256: input.patchSha256 } },
    ],
    predicateType,
    predicate: input.predicate,
  });
}
