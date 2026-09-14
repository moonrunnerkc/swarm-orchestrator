import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { openEvidenceSession } from "../evidence/session.ts";
import { openCampaign } from "./campaign-record.ts";
import { unobservedGoalMetrics } from "./goal-observation.ts";
import { campaignProtocolFixture, goalCampaignProtocolFixture } from "./protocol-fixture.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});
async function campaign() {
  const root = await mkdtemp(join(tmpdir(), "swarm-frozen-campaign-"));
  roots.push(root);
  const evidence = await openEvidenceSession({
    root,
    sessionId: "campaign",
    clock: { now: () => 0, sleep: async () => {} },
  });
  return { evidence, campaign: await openCampaign(campaignProtocolFixture(), evidence) };
}
it("records every launch before outcomes and retains crashes and missing outcomes", async () => {
  const { evidence, campaign: run } = await campaign();
  const first = run.schedule[0];
  if (first === undefined) throw new Error("fixture schedule is empty");
  await run.launch(first.executionId);
  await expect(run.launch(first.executionId)).rejects.toThrow(/duplicate/);
  expect(run.report()).toMatchObject({
    launched: 1,
    pending: 1,
    unknown: 1,
    eligibleForConfirmatoryAnalysis: false,
  });
  await run.settle({
    executionId: first.executionId,
    status: "crashed",
    certified: null,
    heldBackAccepted: null,
    costUsd: null,
    latencyMs: 20,
    evidenceDigest: null,
    cleanup: "failed",
  });
  await expect(run.launch(run.schedule[1]?.executionId ?? "")).rejects.toThrow(/cleanup/);
  expect(run.report()).toMatchObject({
    launched: 1,
    completed: 0,
    unknown: 1,
    cleanupFailed: true,
  });
  expect(evidence.records().map((entry) => entry.type)).toEqual([
    "campaign-protocol",
    "campaign-observation",
    "campaign-observation",
  ]);
  await expect(openCampaign(campaignProtocolFixture(), evidence)).rejects.toThrow(/already frozen/);
});
it("does not pool certifications across comparison arms", async () => {
  const { campaign: run } = await campaign();
  for (const entry of run.schedule) {
    await run.launch(entry.executionId);
    await run.settle({
      executionId: entry.executionId,
      status: "completed",
      certified: true,
      heldBackAccepted: entry.armId === "baseline",
      costUsd: 1,
      latencyMs: 20,
      evidenceDigest: campaignProtocolFixture().verifierDigest,
      cleanup: "confirmed",
    });
  }
  const report = run.report();
  expect(report.arms.map((arm) => [arm.certified, arm.falseGreens])).toEqual([
    [1, 0],
    [1, 1],
  ]);
  expect(report.comparisons[0]?.nonInferior).toBe(false);
});

it("replays recorded launches and settlements without replaying an ambiguous effect", async () => {
  const { evidence, campaign: first } = await campaign();
  const executionId = first.schedule[0]?.executionId ?? "";
  await first.launch(executionId);
  const reopened = await openCampaign(campaignProtocolFixture(), evidence, { resume: true });
  expect(reopened.unresolved()).toEqual([executionId]);
  await expect(reopened.launch(reopened.schedule[1]?.executionId ?? "")).rejects.toThrow(
    "reconciliation",
  );
  await reopened.settle({
    executionId,
    status: "completed",
    certified: true,
    heldBackAccepted: true,
    costUsd: 1,
    latencyMs: 20,
    evidenceDigest: campaignProtocolFixture().verifierDigest,
    cleanup: "confirmed",
  });
  const resumed = await openCampaign(campaignProtocolFixture(), evidence, { resume: true });
  expect(resumed.completed(executionId)).toBe(true);
  await expect(resumed.launch(executionId)).rejects.toThrow("duplicate");
  const altered = campaignProtocolFixture();
  altered.budgets.tokens += 1;
  await expect(openCampaign(altered, evidence, { resume: true })).rejects.toThrow("preserve");
});

it("refuses an appended history event that changes a frozen launch identity", async () => {
  const { evidence, campaign: first } = await campaign();
  const planned = first.schedule[0];
  if (planned === undefined) throw new Error("fixture has no schedule");
  await evidence.record({
    type: "campaign-observation",
    actor: "harness",
    provenance: ["tool-output"],
    payload: {
      phase: "launched",
      protocolDigest: first.report().protocolDigest,
      ...planned,
      armId: "invented",
    },
  });
  await expect(openCampaign(campaignProtocolFixture(), evidence, { resume: true })).rejects.toThrow(
    "frozen identity",
  );
});

it("replays cancelled goal outcomes with outstanding token reservations", async () => {
  const root = await mkdtemp(join(tmpdir(), "swarm-campaign-reservation-"));
  roots.push(root);
  const options = { root, sessionId: "campaign", clock: { now: () => 0, sleep: async () => {} } };
  const evidence = await openEvidenceSession(options);
  const protocol = goalCampaignProtocolFixture();
  const campaign = await openCampaign(protocol, evidence);
  const first = campaign.schedule[0];
  if (first === undefined) throw new Error("fixture schedule is empty");
  await campaign.launch(first.executionId);
  const outcome = {
    executionId: first.executionId,
    status: "cancelled",
    certified: null,
    heldBackAccepted: null,
    costUsd: null,
    latencyMs: 20,
    evidenceDigest: null,
    cleanup: "confirmed",
    goal: {
      ...unobservedGoalMetrics(1, "cancelled", "cancelled with usage still unknown"),
      reservedTokens: 600000,
      unknownCalls: 1,
    },
  };
  await campaign.settle(outcome);
  const reopened = await openCampaign(protocol, await openEvidenceSession(options), {
    resume: true,
  });
  expect(reopened.completed(first.executionId)).toBe(true);
  expect(reopened.report()).toEqual(campaign.report());
  expect(evidence.payloads().get(evidence.records().at(-1)?.payloadDigest ?? "")).toMatchObject({
    goal: { reservedTokens: 600000, unknownCalls: 1 },
  });
});
