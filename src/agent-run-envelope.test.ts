import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assembleToolset } from "./agent-run.ts";
import { openEvidenceSession } from "./evidence/session.ts";
import { establishExecutionEnvelope } from "./exec/run-envelope.ts";

let root = "";
let workspace = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-run-envelope-"));
  workspace = await mkdtemp(join(tmpdir(), "swarm-run-envelope-ws-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
});

describe("what a run says it executed under", () => {
  it("measures the envelope against the guard the run was actually assembled with", async () => {
    const evidence = await openEvidenceSession({
      root: join(root, "sessions"),
      sessionId: "envelope-run",
      clock: { now: () => 0, sleep: () => Promise.resolve() },
    });
    const toolset = assembleToolset({
      workspace,
      homeDir: root,
      confirm: () => Promise.resolve(true),
      evidence,
      tools: () => [],
    });

    const envelope = await establishExecutionEnvelope({
      evidence,
      guard: toolset.guard,
      repositoryConfigTrusted: false,
    });

    // Nothing kernel-enforced stands in front of a command here, so the honest answer is
    // restricted. Reporting "sandboxed" for a lexical policy is the claim this replaces.
    expect(envelope.mode).toBe("restricted");
    expect(envelope.writablePaths).toContain(toolset.guard.workspaceRoot);
    expect(evidence.records().some((entry) => entry.type === "execution-envelope")).toBe(true);
  }, 30_000);
});
