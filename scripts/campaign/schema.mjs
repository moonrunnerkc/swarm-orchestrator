/**
 * The campaign's data shapes, validated at every boundary the campaign scripts cross: a goal
 * package read from disk, a sealed hidden oracle, the frozen manifest of launches, and each
 * launch record written after a launch. A shape that does not parse is refused by name; nothing
 * is coerced into a default the author did not write.
 */
import { z } from "zod";

const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const commit = z.string().regex(/^[0-9a-f]{40}$/);
const slug = z.string().regex(/^[a-z][a-z0-9-]{2,63}$/);
const relativePath = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_.@][A-Za-z0-9_.@/-]*$/)
  .refine((path) => !path.split("/").includes(".."), "a path may not climb out of its root");

export const workTypes = ["bugfix", "feature", "refactor", "upgrade"];
export const surfaces = ["cli", "http", "browser", "multi-package"];
export const attackFamilies = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

/**
 * What a condition is, told apart on two axes so a refusal of forged evidence around correct
 * source is never counted as a false rejection of correct source.
 */
export const conditionTruths = [
  "correct",
  "incorrect",
  "correct-source-forged-evidence",
  "incorrect-source-forged-evidence",
];

/** How a condition is delivered: one submission, a replay after an accepted one, or a cut run. */
export const procedures = ["single", "stale-replay", "interrupt-resume"];

export const conditionSchema = z.strictObject({
  id: slug,
  patch: relativePath,
  truth: z.enum(conditionTruths),
  /** Whether the source the patch leaves behind meets the requirement, as the oracle reads it. */
  sourceCorrect: z.boolean(),
  evidence: z.enum(["honest", "forged"]),
  attackFamilies: z.array(z.number().int().min(1).max(13)).max(13),
  procedure: z.enum(procedures).default("single"),
  /** For a stale replay, the condition whose acceptance is replayed first. */
  replayOf: slug.optional(),
  description: z.string().min(10).max(2000),
});

export const hiddenOracleSchema = z.strictObject({
  schema: z.literal("swarm-campaign.hidden-oracle.v1"),
  goal: slug,
  /** Files copied over the candidate tree, relative to the sealed directory and the checkout. */
  files: z.array(z.strictObject({ from: relativePath, to: relativePath })).min(1),
  /** Run after the install, with the network off, before the oracle itself (a build, say). */
  setup: z.array(z.array(z.string().min(1)).min(1)).default([]),
  argv: z.array(z.string().min(1)).min(1),
  runtime: z.enum(["node", "python", "browser"]),
  timeoutMs: z.number().int().min(1000).max(1_800_000),
  description: z.string().min(10).max(4000),
});

export const goalSchema = z
  .strictObject({
    schema: z.literal("swarm-campaign.goal.v1"),
    id: slug,
    set: z.enum(["final", "development"]),
    repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    upstreamBase: commit,
    ecosystem: z.enum(["node", "python"]),
    manager: z.enum(["npm", "pnpm", "uv"]),
    /** The manager version the lockfile declares, prepared before install. */
    managerVersion: z.string().min(1).max(64),
    workType: z.enum(workTypes),
    surfaces: z.array(z.enum(surfaces)).max(4),
    /** Packages selected for a multi-package goal, repository-relative. */
    packages: z.array(relativePath).max(16).default([]),
    provenance: z.string().min(10).max(2000),
    /** The visible requirement, given verbatim to every arm. */
    taskText: z.string().min(20).max(8000),
    /** The repository's own ordinary check command, as its CI runs it. */
    projectTest: z.array(z.string().min(1)).min(1),
    install: z.array(z.array(z.string().min(1)).min(1)).min(1),
    contract: relativePath,
    reference: relativePath,
    conditions: z.array(conditionSchema).min(5).max(12),
    hidden: z.strictObject({ digest }),
  })
  .superRefine((goal, context) => {
    const ids = goal.conditions.map((condition) => condition.id);
    if (new Set(ids).size !== ids.length)
      context.addIssue({ code: "custom", message: `duplicate condition id in ${goal.id}` });
    if (!goal.conditions.some((one) => one.truth === "correct" && one.procedure === "single"))
      context.addIssue({ code: "custom", message: `${goal.id} has no clean correct condition` });
    for (const condition of goal.conditions) {
      const expected = condition.sourceCorrect
        ? condition.evidence === "honest"
          ? "correct"
          : "correct-source-forged-evidence"
        : condition.evidence === "honest"
          ? "incorrect"
          : "incorrect-source-forged-evidence";
      if (condition.truth !== expected)
        context.addIssue({
          code: "custom",
          message: `${goal.id}/${condition.id}: truth ${condition.truth} contradicts its source and evidence labels`,
        });
      if ((condition.procedure === "stale-replay") !== (condition.replayOf !== undefined))
        context.addIssue({
          code: "custom",
          message: `${goal.id}/${condition.id}: a stale replay names the condition it replays, and only it does`,
        });
      if (condition.replayOf !== undefined && !ids.includes(condition.replayOf))
        context.addIssue({
          code: "custom",
          message: `${goal.id}/${condition.id}: replays an unknown condition`,
        });
    }
    if (goal.surfaces.includes("multi-package") && goal.packages.length === 0)
      context.addIssue({
        code: "custom",
        message: `${goal.id}: a multi-package goal names its packages`,
      });
  });

/** Every arm the campaign can launch, by comparison. */
export const comparisonAArms = ["a-ci", "a-vera", "a-sv-s0", "a-sv-s1", "a-ranex", "a-critique"];
export const comparisonBArms = [
  "b1-ci",
  "b2-sv-baseline",
  "b3-sv-challenges",
  "b4-sv-repair",
  "b5-vera",
];

const launchBase = {
  id: z.string().regex(/^[a-z0-9][a-z0-9.-]{4,160}$/),
  order: z.number().int().nonnegative(),
  goal: slug,
  set: z.enum(["final", "development"]),
  repetition: z.number().int().min(1).max(10),
};

export const launchSchema = z.discriminatedUnion("comparison", [
  z.strictObject({
    comparison: z.literal("A"),
    ...launchBase,
    arm: z.enum(comparisonAArms),
    condition: slug,
  }),
  z.strictObject({
    comparison: z.literal("B"),
    ...launchBase,
    arm: z.enum(comparisonBArms),
  }),
]);

export const manifestSchema = z
  .strictObject({
    schema: z.literal("swarm-campaign.manifest.v1"),
    protocol: z.strictObject({ path: relativePath, digest }),
    goalsDigest: digest,
    /** Every goal's frozen identity: its package files' digest and its sealed oracle's digest. */
    goals: z.array(z.strictObject({ id: slug, set: z.enum(["final", "development"]), digest })),
    orderSeed: z.string().min(8),
    /** Tool, model and source pins every launch runs under. */
    pins: z.strictObject({
      swarmRevision: z.string().regex(/^[0-9a-f]{40}$/),
      swarmCli: z.string().min(1),
      model: z.string().min(1),
      endpoint: z.string().url(),
      vera: z.string().min(1),
    }),
    budgets: z.strictObject({
      launchWallMs: z.number().int().positive(),
      finalVerificationReserveMs: z.number().int().positive(),
      tokens: z.number().int().positive(),
      verifierMs: z.number().int().positive(),
      infrastructureReruns: z.number().int().min(0).max(3),
    }),
    launches: z.array(launchSchema).min(1),
    unsupported: z.array(
      z.strictObject({
        comparison: z.enum(["A", "B"]),
        arm: z.string().min(1),
        goal: slug.optional(),
        reason: z.string().min(10),
      }),
    ),
  })
  .superRefine((manifest, context) => {
    const ids = manifest.launches.map((launch) => launch.id);
    if (new Set(ids).size !== ids.length)
      context.addIssue({ code: "custom", message: "duplicate launch id in the manifest" });
    const orders = manifest.launches.map((launch) => launch.order);
    if (new Set(orders).size !== orders.length)
      context.addIssue({ code: "custom", message: "two launches share one position in the order" });
  });

export const decisions = ["accept", "refuse", "inconclusive", "infrastructure-failure"];

export const launchRecordSchema = z.strictObject({
  schema: z.literal("swarm-campaign.launch-record.v1"),
  launch: z.string().min(1),
  attempt: z.number().int().min(1),
  manifestDigest: digest,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  wallMs: z.number().int().nonnegative(),
  host: z.strictObject({ platform: z.string(), arch: z.string(), node: z.string() }),
  versions: z.record(z.string(), z.string()),
  inputs: z.record(z.string(), digest),
  commands: z.array(
    z.strictObject({
      argv: z.array(z.string()),
      cwd: z.string(),
      exitCode: z.number().int().nullable(),
      signal: z.string().nullable(),
      wallMs: z.number().int().nonnegative(),
      stdoutDigest: digest,
      stderrDigest: digest,
      stdoutBytes: z.number().int().nonnegative(),
      stderrBytes: z.number().int().nonnegative(),
    }),
  ),
  tokens: z.strictObject({
    input: z.number().int().nonnegative().nullable(),
    output: z.number().int().nonnegative().nullable(),
    /** Where only a combined count is reported. Null is unmeasured, never zero. */
    total: z.number().int().nonnegative().nullable(),
    basis: z.string().min(1),
  }),
  decision: z.enum(decisions),
  decisionBasis: z.string().min(1),
  truth: z
    .strictObject({
      condition: z.enum(conditionTruths).optional(),
      hiddenOracle: z.enum(["pass", "fail", "unjudgeable", "not-run"]),
      finalPatchDigest: digest.optional(),
    })
    .nullable(),
  humanInterventions: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
});
