import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { openEvidenceSession } from "../evidence/session.ts";
import { openCampaign } from "./campaign-record.ts";
import { campaignProtocolFixture } from "./protocol-fixture.ts";

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
