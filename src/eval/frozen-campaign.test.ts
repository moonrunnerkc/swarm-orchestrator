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

it("settles a launch the model server died under as infrastructure, and dispatches nothing after it", async () => {
  const root = await mkdtemp(join(tmpdir(), "swarm-campaign-server-death-"));
  try {
    const protocol = campaignProtocolFixture();
    const evidence = await openEvidenceSession({
      root,
      sessionId: "campaign",
      clock: { now: () => 0, sleep: async () => {} },
    });
    const dispatched: string[] = [];
    let observations = 0;
    const report = await runFrozenCampaign({
      protocol,
      evidence,
      now: () => 0,
      signal: new AbortController().signal,
      // Generating before the first launch, wedged by the time it ends: the models still list and
      // the process is still there, which is what the probe behind `healthy` must not be fooled by.
      health: async () => {
        observations += 1;
        return observations === 1
          ? { healthy: true, processes: 1, memoryBytes: 1024, endpoint: "available" as const }
          : {
              healthy: false,
              processes: 1,
              memoryBytes: 1024,
              endpoint: "unavailable" as const,
              detail: "timeout: no completion within 120000 ms",
            };
      },
      exportEvidence: async () => {},
      executors: protocol.arms.map((arm) => ({
        id: arm.id,
        implementationDigest: arm.implementationDigest,
        run: async () => {
          dispatched.push(arm.id);
          // What an arm looks like from outside when its model stopped answering: it finished,
          // certified nothing, and nothing about that is the arm's doing.
          return {
            status: "completed" as const,
            certified: false,
            heldBackAccepted: false,
            costUsd: 0,
            latencyMs: 1,
            evidenceDigest: protocol.verifierDigest,
            cleanup: "confirmed" as const,
          };
        },
      })),
    });

    expect(dispatched).toEqual(["baseline"]);
    expect(report).toMatchObject({ launched: 1, completed: 0 });
    const payloads = evidence.payloads();
    const recorded = evidence
      .records()
      .map((record) => payloads.get(record.payloadDigest) as Record<string, unknown>);
    expect(recorded).toContainEqual(
      expect.objectContaining({
        phase: "health-after",
        healthy: false,
        detail: "timeout: no completion within 120000 ms",
      }),
    );
    expect(JSON.stringify(recorded)).toContain("infrastructure-failure");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
