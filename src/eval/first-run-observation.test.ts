import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { digestOfBytes } from "../evidence/canonical-json.ts";
import { openEvidenceSession } from "../evidence/session.ts";
import { recordFirstRunObservation } from "./first-run-observation.ts";

it("retains assistance and refuses to count it as an unassisted first run", async () => {
  const root = await mkdtemp(join(tmpdir(), "swarm-study-fixture-"));
  try {
    const clock = createTestClock();
    const evidence = await openEvidenceSession({ root, sessionId: "synthetic", clock });
    const protocol = {
      version: 1,
      buildDigest: digestOfBytes("fixture"),
      phase: "validation",
      sampleSize: 10,
      passingFraction: 0.8,
      capMs: 600000,
      prerequisites: [],
      observer: "fixture-observer",
      participant: "synthetic",
      consent: true,
      fresh: true,
      seenDemo: false,
      readRepository: false,
    };
    await recordFirstRunObservation(
      protocol,
      { milestone: "install-started", action: "synthetic test event" },
      evidence,
      clock,
    );
    clock.advance(100);
    expect(
      await recordFirstRunObservation(
        protocol,
        { milestone: "assistance", action: "synthetic explanation" },
        evidence,
        clock,
      ),
    ).toMatchObject({ elapsedMs: 100, assisted: true, passed: false });
    await expect(
      recordFirstRunObservation(
        { ...protocol, capMs: 700000 },
        { milestone: "failed", action: "fixture" },
        evidence,
        clock,
      ),
    ).rejects.toThrow(/protocol changed/);
    await expect(
      recordFirstRunObservation(
        { ...protocol, fresh: false },
        { milestone: "failed", action: "fixture" },
        evidence,
        clock,
      ),
    ).rejects.toThrow(/validation requires/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
