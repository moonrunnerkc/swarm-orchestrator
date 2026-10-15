/** Shapes the comparison scripts validate at their boundaries; nothing is coerced into a default. */
import { z } from "zod";

const sha = z.string().regex(/^[0-9a-f]{7,40}$/);
const argv = z.array(z.string().min(1)).min(1);
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const workTypes = ["bugfix", "feature", "refactor", "upgrade"];
export const arms = ["swarm", "opencode"];

/**
 * Why a campaign stopped. Each is a failure of the experiment, never of an arm: the endpoint
 * died or changed; the frozen configuration or an arm's runtime is not what it should be; the
 * task environment could not be prepared; the scorer could not judge; a record could not be
 * validated, written or backed by evidence; the runner or a child was interrupted; or the
 * harness itself threw. An arm that fails its task continues the campaign and is none of these.
 */
export const fatalClasses = [
  "endpoint",
  "configuration",
  "preparation",
  "scorer",
  "records",
  "interrupted",
  "harness",
];

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
    /** The answering server instance at launch; a change mid-launch is infrastructure. */
    endpointInstance: z.string().nullable(),
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
  /** Present on an attempt the campaign stopped on: the class and the halt record beside it. */
  halt: z.strictObject({ class: z.enum(fatalClasses), record: z.string() }).optional(),
  /**
   * The mutable state this launch's processes were given: a HOME of its own, fresh when the
   * launch started, with npm's store linked to the shared content-addressed cache; and whether
   * a browser cache was there before the arm ran and after it. Absent on records written before
   * launches had homes of their own, which is itself the finding those records carry.
   */
  preparedState: z
    .strictObject({
      home: z.string(),
      fresh: z.boolean(),
      npmCache: z.string(),
      browserCacheBefore: z.boolean(),
      browserCacheAfter: z.boolean(),
    })
    .optional(),
  /**
   * For a Swarm launch: the tests gate the task names, the command the product's own check ran
   * under this launch's HOME, its status on the prepared base, and the verdict. A launch is not
   * dispatched unless `ok`; the record keeps the measurement either way.
   */
  gatePlan: z
    .strictObject({
      ok: z.boolean(),
      expected: z.string(),
      effective: z.string().nullable(),
      status: z.string().nullable(),
      bundleDirectory: z.string().nullable(),
      detail: z.string(),
    })
    .optional(),
});

const launchRef = z.strictObject({ task: z.string(), arm: z.enum(arms), order: z.number() });

export const haltSchema = z.strictObject({
  schema: z.literal("swarm-ordinary-comparison.halt.v1"),
  manifestDigest: digest,
  class: z.enum(fatalClasses),
  reason: z.string().min(1),
  /** When the failure was seen, and when the halt was recorded. */
  detectedAt: z.string(),
  haltedAt: z.string(),
  /** The launch in progress, its retained attempt record and its kept workspace, if any. */
  launch: launchRef.nullable(),
  attemptRecord: z.string().nullable(),
  scratch: z.string().nullable(),
  cleanup: z.strictObject({
    outcome: z.enum(["terminated", "unconfirmed", "nothing-running"]),
    wallMs: z.number().int().nonnegative(),
    deadlineMs: z.number().int().positive(),
  }),
  /** Children of a runner that died without cleanup, found and stopped on the next start. */
  orphans: z.array(
    z.strictObject({
      pid: z.number().int(),
      started: z.string(),
      outcome: z.enum(["terminated", "unconfirmed", "already-gone"]),
    }),
  ),
  remaining: z.array(launchRef),
  identity: z.strictObject({
    pins: z.record(z.string(), z.unknown()),
    harnessDigest: digest,
    node: z.string(),
    platform: z.string(),
  }),
  runner: z.strictObject({ pid: z.number().int(), started: z.string().nullable() }),
  notes: z.array(z.string()),
});

export const recoverySchema = z.strictObject({
  schema: z.literal("swarm-ordinary-comparison.recovery.v1"),
  manifestDigest: digest,
  recoveredAt: z.string(),
  /** The halt this clears, by file name and digest, so the pairing is checkable. */
  clears: z.string(),
  clearsDigest: digest,
  justification: z.string().min(1),
  revalidation: z.strictObject({
    problems: z.array(z.string()),
    harnessDigest: digest,
    node: z.string(),
    endpointInstance: z.string().nullable(),
    models: z.array(z.string()),
    opencode: z.string(),
    swarmCliDigest: digest.nullable(),
  }),
  completed: z.number().int().nonnegative(),
  remaining: z.array(launchRef),
});
