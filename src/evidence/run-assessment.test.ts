import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import type { JsonValue } from "./canonical-json.ts";
import { runLifecycle } from "./run-assessment.ts";
import { type EvidenceRecorder, openEvidenceSession } from "./session.ts";

let root = "";
let evidence: EvidenceRecorder;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-run-assessment-"));
  evidence = await openEvidenceSession({
    root,
    sessionId: "lifecycle-session",
    clock: createTestClock(1_700_000_000_000),
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const stopped = (payload: Record<string, JsonValue>) =>
  evidence.record({
    type: "session-stopped",
    actor: "harness",
    provenance: ["tool-output"],
    payload,
  });

const owed = (rule: string, payload: Record<string, JsonValue>) =>
  evidence.record({
    type: "verification-command",
    actor: "harness",
    provenance: ["tool-output"],
    payload: { rule, ...payload },
  });

/**
 * The lifecycle the assessment names and the bundled verifier re-derives: the last stop of a
 * loop that worked the task. These cases pin the rule, the fields that carry it, and the
 * reading of records written before those fields existed.
 */
describe("the run's lifecycle, read off the chain", () => {
  it("is the first loop's stop where no repair followed", async () => {
    await stopped({ stopReason: "max-steps", steps: 40 });
    expect(runLifecycle(evidence)).toBe("max-steps");
  });

  it("stays the interrupted loop's when a narrow repair finished, and becomes the repair's when the repair stopped at a limit", async () => {
    await stopped({ stopReason: "max-steps", steps: 40 });
    await stopped({ stopReason: "completed", repair: true, attempt: 1, runLifecycle: false });
    expect(runLifecycle(evidence)).toBe("max-steps");
    await stopped({ stopReason: "max-tokens", repair: true, attempt: 2 });
    expect(runLifecycle(evidence)).toBe("max-tokens");
  });

  it("reads a repair's finish as the lifecycle where the record predates the field, as it always did", async () => {
    await stopped({ stopReason: "max-steps", steps: 40 });
    await stopped({ stopReason: "completed", repair: true });
    expect(runLifecycle(evidence)).toBe("completed");
  });

  it("is an owed attempt's stop only where its candidate was kept, matched by attempt", async () => {
    await stopped({ stopReason: "max-steps", steps: 40 });
    await stopped({ stopReason: "completed", repair: true, attempt: 1, runLifecycle: false });
    await stopped({
      stopReason: "completed",
      repair: true,
      attempt: 2,
      followUp: true,
      continuation: true,
    });
    await owed("task-continuation-v1", { state: "given", attempt: 2, accepted: false });
    expect(runLifecycle(evidence)).toBe("max-steps");
    await stopped({ stopReason: "completed", repair: true, attempt: 3, followUp: true });
    await owed("outcome-follow-up-v1", { state: "given", attempt: 3, accepted: true });
    expect(runLifecycle(evidence)).toBe("completed");
  });

  it("reads a follow-up stop without an attempt by the last follow-up record, as it always did", async () => {
    await stopped({ stopReason: "completed", steps: 3 });
    await stopped({ stopReason: "max-wall-time", repair: true, followUp: true });
    await owed("outcome-follow-up-v1", { state: "given", attempt: 1, accepted: false });
    expect(runLifecycle(evidence)).toBe("completed");
  });

  it("skips a withheld attempt, whose stop reason is not a lifecycle, and reads nothing before any loop stopped", async () => {
    expect(runLifecycle(evidence)).toBeNull();
    await stopped({ stopReason: "completed", steps: 3 });
    await stopped({ stopReason: "repair-withheld", repair: true, attempt: 1 });
    expect(runLifecycle(evidence)).toBe("completed");
  });
});
