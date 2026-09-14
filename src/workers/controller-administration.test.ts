import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { openRunStore } from "../durable/run-store.ts";
import { openEvidenceSession } from "../evidence/session.ts";
import { controllerAdministration } from "./controller-administration.ts";
import { recordControllerEvent } from "./controller-events.ts";

it("rebuilds measured usage without a fresh ceiling and sees another process's abort", async () => {
  const root = await mkdtemp(join(tmpdir(), "controller-admin-"));
  try {
    const clock = createTestClock(1000);
    const evidence = await openEvidenceSession({ root, sessionId: "queue", clock });
    await recordControllerEvent(evidence, {
      kind: "run-started",
      version: 1,
      runId: "run",
      startedAt: 1000,
      deadlineAt: 2000,
      maxTokens: 20000,
      modelConcurrency: 1,
      testConcurrency: 1,
    });
    const options = {
      evidence,
      path: join(root, "runs.jsonl"),
      runId: "run",
      objective: "goal",
      clock,
      maxTokens: 20000,
    };
    const admin = controllerAdministration(options);
    await recordControllerEvent(evidence, {
      kind: "usage-reserved",
      id: "model-1",
      activity: "planning",
      inputAllowance: 14000,
      outputAllowance: 1000,
      estimator: "utf8-bytes-plus-framing",
    });
    admin.synchronize();
    const other = openRunStore(options.path);
    expect(other.remainingTokens("run")).toBe(5000);
    await recordControllerEvent(evidence, {
      kind: "usage-settled",
      id: "model-1",
      status: "reported",
      inputTokens: 8000,
      outputTokens: 500,
      detail: "reported",
    });
    admin.synchronize();
    admin.close();
    const reopened = controllerAdministration(options);
    reopened.synchronize();
    expect(other.remainingTokens("run")).toBe(11500);
    expect(other.steps("run")).toMatchObject([
      { stepId: "model-1", kind: "planning", state: "done", attempt: 1 },
    ]);
    other.abortRun("run", "operator stopped", 1001);
    expect(reopened.aborted()).toBe(true);
    reopened.finish(false, "aborted");
    expect(other.run("run")?.state).toBe("aborted");
    reopened.close();
    other.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
