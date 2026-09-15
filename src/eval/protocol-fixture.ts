import { digestOfBytes } from "../evidence/canonical-json.ts";
import type { GoalCampaignProtocol } from "./goal-protocol.ts";
import type { CampaignProtocol } from "./protocol.ts";

export function campaignProtocolFixture(): CampaignProtocol {
  const digest = digestOfBytes("fixture");
  return {
    version: 1,
    population: "fixture repositories",
    samplingUnit: "independent-repository",
    exposure: "held-out",
    stratum: "ordinary",
    cases: [
      {
        id: "one",
        repository: "repo-one",
        baseCommit: "abc",
        oracleDigest: digest,
        heldBackDigest: digest,
        sourceDigest: digest,
      },
    ],
    arms: ["baseline", "candidate"].map((id) => ({
      id,
      implementationDigest: digest,
      model: "fixture",
      backendDigest: digest,
    })),
    verifierDigest: digest,
    budgets: { tokens: 100, wallMs: 1000 },
    seeds: [0],
    order: "counterbalanced",
    stopping: "fixed-schedule",
    failureDisposition: "retain-all-launched",
    baseline: "baseline",
    baselineSelectionDigest: digest,
    margin: 0.05,
    targetUpperBound: 0.05,
    interval: "paired-hoeffding-95",
  };
}

export function goalCampaignProtocolFixture(): GoalCampaignProtocol {
  const digest = digestOfBytes("goal-fixture");
  const cases: GoalCampaignProtocol["cases"] = Array.from({ length: 24 }, (_, index) => ({
    id: `goal-${index}`,
    repository: `repository-${index % 8}`,
    baseCommit: index.toString(16).padStart(40, "0"),
    sourceLocation: `fixture:${index}`,
    sourceDigest: digest,
    oracleDigest: digest,
    heldBackDigest: digest,
    requirementIds: ["behavior"],
    category: "feature",
    language: index < 9 ? "python" : "typescript",
    stratum: "synthetic-integration",
    previouslyExposed: false,
  }));
  return {
    version: 2,
    population: "synthetic protocol test",
    stage: "pilot",
    samplingUnit: "goal-clustered-by-repository",
    exposure: "development",
    cases,
    arms: (["single", "frozen-parallel", "adaptive", "no-adaptation", "no-peer"] as const).map(
      (role) => ({
        id: role,
        role,
        implementationDigest: digest,
        model: "fixture",
        backendDigest: digest,
        settingsDigest: digest,
        comparability: "same fixture model and final checks",
      }),
    ),
    verifierDigest: digest,
    budgets: { tokens: 10000, wallMs: 1000 },
    limits: {
      maxSteps: 20,
      attempts: 2,
      repairAttempts: 2,
      graphRevisions: 4,
      modelConcurrency: 1,
      testConcurrency: 1,
      worktreeConcurrency: 2,
      cleanupMs: 1000,
    },
    seeds: [0],
    order: "rotating-arm-order",
    stopping: "fixed-schedule",
    failureDisposition: "retain-all-scheduled",
    baseline: "single",
    baselineSelectionDigest: digest,
    comparisonCases: cases.map((goal) => goal.id),
    targetMedianTimeRatio: 0.75,
    interval: "repository-bootstrap-95-descriptive",
    resamplingSeed: 123,
    exclusions: "none-after-freeze",
    competitorDisposition: "not applicable to deterministic fixture tests",
  };
}
