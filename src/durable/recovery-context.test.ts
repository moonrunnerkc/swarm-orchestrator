import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { digestOfJson } from "../evidence/canonical-json.ts";
import { sealRunSpec } from "../evidence/run-spec.ts";
import { openEvidenceSession } from "../evidence/session.ts";
import { recoveryContext } from "./recovery-context.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(toolName = "read") {
  const root = await mkdtemp(join(tmpdir(), "swarm-recovery-context-"));
  roots.push(root);
  const evidence = await openEvidenceSession({
    root,
    sessionId: "one",
    clock: createTestClock(100),
  });
  await sealRunSpec(evidence, {
    version: 1,
    repository: { root: "/repo", baseCommit: "a".repeat(40) },
    task: "fix",
    architecture: "single-agent",
    model: { spec: "fixture:one", pinned: true },
    tools: ["read", "write"],
    network: "denied",
    paths: { writable: ["src/**"], immutable: [] },
    taskOracle: null,
    gates: [{ id: "tests", severity: "blocking", capability: "dynamic" }],
    budgets: { maxSteps: 10, attempts: 2, maxTokens: 1000, maxWallMs: 10000 },
    retention: { sessionsOlderThan: "30d" },
    signer: { policy: "any-key", signers: [] },
    isolation: { mode: "restricted", backend: "host" },
    humanApproval: { required: [] },
    versions: { tool: "fixture", schema: 1, node: "24" },
  });
  await evidence.record({
    type: "gate-set-sealed",
    actor: "harness",
    provenance: ["user"],
    payload: {
      criteriaRef: "a".repeat(40),
      detectedTypes: ["node"],
      gates: [
        {
          id: "tests",
          title: "tests",
          severity: "blocking",
          source: "command",
          command: "node --test",
          parser: "test-output",
        },
      ],
      budgets: { maxChangedFiles: 12, maxAddedLines: 600 },
      attemptCap: 2,
      ratchetArms: ["testsCollected"],
    },
  });
  const prompt = { messages: [{ role: "user", text: "fix" }] };
  const response = {
    text: "",
    toolCalls: [{ callId: "c1", toolName, input: { path: "src/file.ts" } }],
  };
  await evidence.record({
    type: "model-call",
    actor: "fixture",
    provenance: ["model"],
    promptDigest: digestOfJson(prompt),
    responseDigest: digestOfJson(response),
    payload: { prompt, response, usageStatus: "reported", inputTokens: 100, outputTokens: 50 },
  });
  return { root, evidence };
}
it("reconstructs complete call groups and preserves the absolute budget including downtime", async () => {
  const { root } = await fixture();
  const context = await recoveryContext(root, "one", 1100);
  expect(context).toMatchObject({
    remainingTokens: 850,
    remainingSteps: 9,
    remainingWallMs: 9000,
    deadline: 10100,
  });
  expect(context.history.map((message) => message.role)).toEqual(["user", "assistant", "tool"]);
  expect(context.pending[0]?.toolName).toBe("read");
  await expect(recoveryContext(root, "one", 10100)).rejects.toThrow(/no execution budget/);
});
it("refuses ambiguous writes and never replays their effects", async () => {
  const { root } = await fixture("write");
  await expect(recoveryContext(root, "one", 101)).rejects.toThrow(/ambiguous effects: write:c1/);
});
it("refuses an unfinished provider dispatch whose bill cannot be reconstructed", async () => {
  const { root, evidence } = await fixture();
  await evidence.record({
    type: "model-call-started",
    actor: "harness",
    provenance: ["model"],
    payload: { step: 2 },
  });
  await expect(recoveryContext(root, "one", 101)).rejects.toThrow(
    /provider call has no durable outcome/,
  );
});
it("uses the recorded terminal outcome without dispatching an already completed write", async () => {
  const { root, evidence } = await fixture("write");
  await evidence.record({
    type: "tool-call",
    actor: "harness",
    provenance: ["tool-output"],
    payload: { callId: "c1", decision: "allowed", output: "written" },
  });
  expect((await recoveryContext(root, "one", 101)).pending).toEqual([]);
});
