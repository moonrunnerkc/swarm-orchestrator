import { z } from "zod";

const identity = z.string().min(1).max(256);
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const count = z.number().int().nonnegative();
const positive = z.number().int().positive();
export const goalCampaignProtocolSchema = z
  .strictObject({
    version: z.literal(2),
    population: identity,
    stage: z.enum(["development", "pilot"]),
    samplingUnit: z.literal("goal-clustered-by-repository"),
    exposure: z.enum(["development", "held-out", "previously-exposed"]),
    cases: z
      .array(
        z.strictObject({
          id: identity,
          repository: identity,
          baseCommit: z.string().regex(/^[0-9a-f]{40,64}$/),
          sourceLocation: z.string().min(1),
          sourceDigest: digest,
          oracleDigest: digest,
          heldBackDigest: digest,
          requirementIds: z.array(identity).min(1),
          category: z.enum(["feature", "bug-fix", "api-change", "upgrade", "refactor", "no-op"]),
          language: z.enum(["javascript", "typescript", "python"]),
          stratum: z.enum(["natural-history", "synthetic-integration"]),
          previouslyExposed: z.boolean(),
        }),
      )
      .min(1),
    arms: z
      .array(
        z.strictObject({
          id: identity,
          implementationDigest: digest,
          model: identity,
          backendDigest: digest,
          role: z.enum([
            "single",
            "frozen-parallel",
            "adaptive",
            "no-adaptation",
            "no-peer",
            "competitor",
          ]),
          settingsDigest: digest,
          comparability: z.string().min(1),
        }),
      )
      .min(2),
    verifierDigest: digest,
    budgets: z.strictObject({ tokens: positive, wallMs: positive }),
    limits: z.strictObject({
      maxSteps: positive,
      attempts: count,
      repairAttempts: count,
      graphRevisions: count.max(16),
      modelConcurrency: positive,
      testConcurrency: positive,
      worktreeConcurrency: positive,
      cleanupMs: positive,
    }),
    seeds: z.array(count).min(1),
    order: z.literal("rotating-arm-order"),
    stopping: z.literal("fixed-schedule"),
    failureDisposition: z.literal("retain-all-scheduled"),
    baseline: identity,
    baselineSelectionDigest: digest,
    comparisonCases: z.array(identity).min(1),
    targetMedianTimeRatio: z.number().positive().max(1),
    interval: z.literal("repository-bootstrap-95-descriptive"),
    resamplingSeed: positive,
    exclusions: z.literal("none-after-freeze"),
    competitorDisposition: z.string().min(1),
  })
  .superRefine((protocol, context) => {
    const issue = (message: string) => context.addIssue({ code: "custom", message });
    for (const [label, names] of [
      ["case", protocol.cases.map((entry) => entry.id)],
      ["arm", protocol.arms.map((entry) => entry.id)],
      ["arm role", protocol.arms.map((entry) => entry.role)],
      ["seed", protocol.seeds.map(String)],
      ["comparison case", protocol.comparisonCases],
    ] as const)
      if (new Set(names).size !== names.length) issue(`duplicate ${label} identity`);
    for (const goal of protocol.cases)
      if (new Set(goal.requirementIds).size !== goal.requirementIds.length)
        issue(`duplicate requirement in ${goal.id}`);
    if (!protocol.arms.some((arm) => arm.id === protocol.baseline && arm.role === "single"))
      issue("baseline must be the declared strong single worker");
    if (protocol.comparisonCases.some((id) => !protocol.cases.some((goal) => goal.id === id)))
      issue("comparison subset names an undeclared goal");
    if (protocol.exposure === "held-out" && protocol.cases.some((goal) => goal.previouslyExposed))
      issue("previously exposed goals cannot become fresh held-out evidence");
    if (protocol.stage === "pilot") {
      if (
        protocol.cases.length < 24 ||
        new Set(protocol.cases.map((goal) => goal.repository)).size < 8
      )
        issue("pilot needs at least 24 distinct goals across eight repositories");
      for (const role of ["single", "frozen-parallel", "adaptive", "no-adaptation", "no-peer"])
        if (!protocol.arms.some((arm) => arm.role === role)) issue(`pilot is missing ${role}`);
      if (
        !protocol.cases.some((goal) => goal.language === "python") ||
        !protocol.cases.some((goal) => goal.language !== "python")
      )
        issue("pilot requires Python and JavaScript or TypeScript goals");
    }
  });
export type GoalCampaignProtocol = z.infer<typeof goalCampaignProtocolSchema>;
