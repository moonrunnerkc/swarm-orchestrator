import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openEvidenceSession } from "../evidence/session.ts";
import { runFrozenCampaign } from "./frozen-campaign.ts";
import { campaignProtocolFixture, goalCampaignProtocolFixture } from "./protocol-fixture.ts";

it("dispatches different frozen implementations and exports failure evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "swarm-arm-dispatch-"));
  try {
    const protocol = campaignProtocolFixture();
    const evidence = await openEvidenceSession({
      root,
      sessionId: "campaign",
      clock: { now: () => 0, sleep: async () => {} },
    });
    const dispatched: string[] = [];
    let exported = false;
    const report = await runFrozenCampaign({
      protocol,
      evidence,
      now: () => 0,
      signal: new AbortController().signal,
      health: async () => ({
        healthy: true,
        processes: 1,
        memoryBytes: 1024,
        endpoint: "not-required",
      }),
      exportEvidence: async () => {
        exported = true;
      },
      executors: protocol.arms.map((arm) => ({
        id: arm.id,
        implementationDigest: arm.implementationDigest,
        run: async (execution) => {
          dispatched.push(arm.id);
          expect(execution.budget).toEqual(protocol.budgets);
          if (arm.id === "candidate") throw new Error("fixture crash");
          return {
            status: "completed",
            certified: true,
            heldBackAccepted: true,
            costUsd: 1,
            latencyMs: 1,
            evidenceDigest: protocol.verifierDigest,
            cleanup: "confirmed",
          };
        },
      })),
    });
    expect(dispatched).toEqual(["baseline", "candidate"]);
    expect(exported).toBe(true);
    expect(report).toMatchObject({ launched: 2, completed: 1, unknown: 1 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("records every unlaunched pilot execution when an endpoint is unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "swarm-pilot-admission-"));
  try {
    const protocol = goalCampaignProtocolFixture();
    const evidence = await openEvidenceSession({
      root,
      sessionId: "pilot",
      clock: { now: () => 0, sleep: async () => {} },
    });
    let launches = 0;
    const report = await runFrozenCampaign({
      protocol,
      evidence,
      now: () => 0,
      signal: new AbortController().signal,
      health: async () => ({
        healthy: true,
        processes: 0,
        memoryBytes: 0,
        endpoint: "unavailable",
      }),
      exportEvidence: async () => {},
      executors: protocol.arms.map((arm) => ({
        id: arm.id,
        implementationDigest: arm.implementationDigest,
        run: async () => {
          launches++;
          throw new Error("unreachable provider");
        },
      })),
    });
    expect(launches).toBe(0);
    expect(report.notLaunched).toHaveLength(120);
    expect(report.goal).toMatchObject({
      allObserved: false,
      settledRuns: 0,
      scheduledGoals: 24,
      repositories: 8,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
