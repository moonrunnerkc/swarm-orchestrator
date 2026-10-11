/** Shapes the comparison scripts validate at their boundaries; nothing is coerced into a default. */
import { z } from "zod";

const sha = z.string().regex(/^[0-9a-f]{7,40}$/);
const argv = z.array(z.string().min(1)).min(1);
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const workTypes = ["bugfix", "feature", "refactor", "upgrade"];
export const arms = ["swarm", "opencode"];

export const taskSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{3,80}$/),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  workType: z.enum(workTypes),
  baseCommit: sha,
  upstreamCommit: sha,
  install: z.array(argv).min(1),
  build: z.array(argv),
  projectTest: argv,
  visiblePrefix: z.string(),
  visible: z.strictObject({
    path: z.string().min(1),
    command: z.string().min(1),
    source: z.string().min(1),
  }),
  hidden: z.strictObject({
    testFiles: z.array(z.string().min(1)),
    argv,
    extraArgv: z.array(argv).optional(),
    structural: z
      .array(
        z.strictObject({
          pattern: z.string().min(1),
          files: z.array(z.string().min(1)).min(1),
          count: z.number().int().nonnegative(),
        }),
      )
      .optional(),
    upgrade: z
      .array(
        z.strictObject({
          name: z.string().min(1),
          section: z.enum(["dependencies", "devDependencies"]),
          version: z.string().min(1),
        }),
      )
      .optional(),
  }),
  upgradeSourcePaths: z.array(z.string().min(1)).optional(),
  immutable: z.array(z.string().min(1)),
  taskText: z.string().min(40),
});

export const invocationSchema = z.strictObject({
  kind: z.enum(["initial", "correction"]),
  correction: z.number().int().min(0).max(2),
  argv: z.array(z.string()),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  wallMs: z.number().int().nonnegative(),
  stdoutDigest: digest,
  stderrDigest: digest,
  tokens: z.number().int().nonnegative().nullable(),
  /** The arm's own account of finishing: swarm's verdict, opencode's exit; never the truth. */
  claimedSuccess: z.boolean(),
  visible: z.strictObject({
    checkExit: z.number().int().nullable(),
    projectTestExit: z.number().int().nullable(),
    passed: z.boolean(),
    detailDigest: digest,
  }),
});

export const recordSchema = z.strictObject({
  schema: z.literal("swarm-ordinary-comparison.record.v1"),
  manifestDigest: digest,
  task: z.string(),
  arm: z.enum(arms),
  order: z.number().int().nonnegative(),
  startedAt: z.string(),
  endedAt: z.string(),
  host: z.strictObject({ platform: z.string(), arch: z.string(), node: z.string() }),
  versions: z.strictObject({
    swarmRevision: z.string(),
    opencode: z.string(),
    model: z.string(),
    endpoint: z.string(),
  }),
  preparation: z.strictObject({
    wallMs: z.number().int().nonnegative(),
    ok: z.boolean(),
    detail: z.string(),
  }),
  invocations: z.array(invocationSchema),
  corrections: z.number().int().min(0).max(2),
  resolvedVisible: z.boolean(),
  finalPatchDigest: digest,
  finalPatchBytes: z.number().int().nonnegative(),
  hidden: z.strictObject({
    verdict: z.enum(["pass", "fail", "unjudgeable"]),
    basis: z.string(),
    detailDigest: digest.nullable(),
  }),
  oracleExposure: z.string(),
  totals: z.strictObject({
    agentWallMs: z.number().int().nonnegative(),
    tokens: z.number().int().nonnegative().nullable(),
    tokensUnknownInvocations: z.number().int().nonnegative(),
  }),
  infrastructureFailure: z.string().nullable(),
  notes: z.array(z.string()),
});
