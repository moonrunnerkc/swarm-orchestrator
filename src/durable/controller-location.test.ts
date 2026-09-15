import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { openEvidenceSession } from "../evidence/session.ts";
import { controllerSessionId } from "./controller-location.ts";

it("distinguishes absent, unsupported and damaged histories without creating or repairing them", async () => {
  const root = await mkdtemp(join(tmpdir(), "controller-location-"));
  try {
    expect(await controllerSessionId(root, "missing")).toBeNull();
    await expect(controllerSessionId(root, "../elsewhere")).rejects.toThrow(
      "invalid controller identity",
    );
    const evidence = await openEvidenceSession({
      root,
      sessionId: "run-queue",
      clock: createTestClock(1000),
    });
    await expect(controllerSessionId(root, "run")).rejects.toThrow("without its journal");
    await evidence.record({
      type: "session-started",
      actor: "harness",
      provenance: ["user"],
      payload: { task: "legacy" },
    });
    await expect(controllerSessionId(root, "run")).rejects.toThrow("predates recoverable");
    await evidence.record({
      type: "controller-launch",
      actor: "harness",
      provenance: ["user"],
      payload: { version: 1 },
    });
    expect(await controllerSessionId(root, "run")).toBe("run-queue");
    await appendFile(evidence.ledgerPath, '{"torn":');
    const bytes = await readFile(evidence.ledgerPath, "utf8");
    await expect(controllerSessionId(root, "run")).rejects.toThrow("preserve");
    expect(await readFile(evidence.ledgerPath, "utf8")).toBe(bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
