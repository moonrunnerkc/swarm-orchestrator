import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { openEvidenceSession } from "../evidence/session.ts";
import { openCampaign } from "./campaign-record.ts";
import { goalCampaignProtocolFixture } from "./protocol-fixture.ts";

it("reports clustered paired latency and refuses an apparent speed gain bought by omissions", async () => {
  const root = await mkdtemp(join(tmpdir(), "swarm-goal-campaign-"));
  try {
    const protocol = goalCampaignProtocolFixture();
    const evidence = await openEvidenceSession({
      root,
      sessionId: "campaign",
      clock: createTestClock(),
    });
    const campaign = await openCampaign(protocol, evidence);
    for (const entry of campaign.schedule) {
      await campaign.launch(entry.executionId);
      const omission = entry.armId === "no-peer";
      const observation = {
        executionId: entry.executionId,
        status: "completed",
        certified: !omission,
        heldBackAccepted: !omission,
        costUsd: null,
        latencyMs: entry.armId === "single" ? 100 : 50,
        evidenceDigest: protocol.verifierDigest,
        cleanup: "confirmed",
        goal: {
          inputTokens: 30,
          outputTokens: 10,
          reservedTokens: 0,
          unknownCalls: 0,
          retries: 1,
          integrationFailures: 1,
          integrationRepairs: 1,
          humanInterventions: 0,
          humanRepairMinutes: 0,
          required: 1,
          accepted: omission ? 0 : 1,
          missedChecks: [],
          partialBranch: omission ? "partial" : null,
          termination: "completed",
          detail: "fixture observation",
        },
      };
      if (omission)
        await expect(campaign.settle({ ...observation, certified: true })).rejects.toThrow(
          "incomplete goal",
        );
      await campaign.settle(observation);
    }
    const report = campaign.report();
    expect(report.independentRepositories).toBeNull();
    expect(report.comparisons).toEqual([]);
    expect(report.eligibleForConfirmatoryAnalysis).toBe(false);
    expect(report.goal?.comparisons.find((entry) => entry.armId === "adaptive")).toMatchObject({
      pilotTargetObserved: true,
      medianTimeRatio: { point: 0.5, lower: 0.5, upper: 0.5, repositories: 8 },
    });
    expect(report.goal?.comparisons.find((entry) => entry.armId === "no-peer")).toMatchObject({
      pilotTargetObserved: false,
      failureCensoredPairs: 24,
      medianTimeRatio: { point: 10 },
    });
    expect(report.goal?.arms[0]).toMatchObject({
      complete: 24,
      elapsedMs: 2400,
      inputTokens: 720,
      costUsd: null,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("keeps unknown accounting and unlaunched work visible without an acceptance interval", async () => {
  const root = await mkdtemp(join(tmpdir(), "swarm-goal-incomplete-"));
  try {
    const protocol = goalCampaignProtocolFixture();
    const evidence = await openEvidenceSession({
      root,
      sessionId: "campaign",
      clock: createTestClock(),
    });
    const campaign = await openCampaign(protocol, evidence);
    await campaign.deferRemaining("model endpoint unavailable");
    const report = campaign.report();
    expect(report.notLaunched).toHaveLength(120);
    expect(report.goal?.arms[0]).toMatchObject({
      observed: 0,
      costUsd: null,
      inputTokens: null,
      humanRepairMinutes: null,
    });
    expect(
      report.goal?.comparisons.every(
        (entry) => entry.medianTimeRatio === null && !entry.pilotTargetObserved,
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
