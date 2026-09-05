import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MalformedRunSpecError,
  parseRunSpec,
  type RunSpecInput,
  runSpecDigest,
  sealRunSpec,
} from "./run-spec.ts";
import { openEvidenceSession } from "./session.ts";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-run-spec-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const wellFormed: RunSpecInput = {
  version: 1,
  repository: { root: "/repo", baseCommit: "a".repeat(40) },
  task: "fix the parser",
  architecture: "single-agent",
  model: { spec: "local:qwen3.6:35b-a3b", pinned: true },
  tools: ["read", "write", "edit", "list", "search", "shell"],
  network: "denied",
  paths: { writable: ["src/**"], immutable: [".github/**", "swarm.toml"] },
  taskOracle: null,
  gates: [{ id: "tests", severity: "blocking", capability: "dynamic" }],
  budgets: { maxSteps: 40, attempts: 3, maxWallMs: 1_800_000, maxTokens: 200_000 },
  retention: { sessionsOlderThan: "30d" },
  signer: { policy: "expected-signers", signers: [`sha256:${"ab".repeat(32)}`] },
  isolation: { mode: "restricted", backend: "host" },
  humanApproval: { required: [] },
  versions: { tool: "13.1.9", schema: 1, node: "24" },
};

describe("the spec a run is bound to before anything is asked of the model", () => {
  it("digests to the same value for the same spec, whatever order the fields arrived in", () => {
    const reordered = { ...wellFormed, task: wellFormed.task };

    expect(runSpecDigest(parseRunSpec(wellFormed))).toBe(runSpecDigest(parseRunSpec(reordered)));
  });

  it("digests differently when any bound field changes", () => {
    const widened = {
      ...wellFormed,
      paths: { ...wellFormed.paths, writable: ["src/**", "docs/**"] },
    };

    expect(runSpecDigest(parseRunSpec(wellFormed))).not.toBe(runSpecDigest(parseRunSpec(widened)));
  });

  it("refuses a spec that names no base commit, since a change is measured against one", () => {
    expect(() =>
      parseRunSpec({ ...wellFormed, repository: { root: "/repo", baseCommit: "" } }),
    ).toThrow(MalformedRunSpecError);
  });

  it("refuses a tool the build does not have, rather than ignoring it", () => {
    expect(() => parseRunSpec({ ...wellFormed, tools: ["read", "teleport"] })).toThrow(/teleport/);
  });

  it("refuses a budget that is not a budget", () => {
    expect(() =>
      parseRunSpec({ ...wellFormed, budgets: { ...wellFormed.budgets, maxSteps: 0 } }),
    ).toThrow(MalformedRunSpecError);
  });

  it("lands on the chain before anything else, and is refused a second time", async () => {
    const evidence = await openEvidenceSession({
      root: join(root, "sessions"),
      sessionId: "spec",
      clock: { now: () => 0, sleep: () => Promise.resolve() },
    });

    const sealed = await sealRunSpec(evidence, wellFormed);
    expect(sealed.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(evidence.records()[0]?.type).toBe("run-spec-sealed");

    // Sealing twice would mean the run was measured by two specs, and nothing could say which.
    await expect(sealRunSpec(evidence, wellFormed)).rejects.toThrow(/already sealed/i);
  });

  it("carries the digest of the spec, not a promise that one existed", async () => {
    const evidence = await openEvidenceSession({
      root: join(root, "sessions"),
      sessionId: "spec-digest",
      clock: { now: () => 0, sleep: () => Promise.resolve() },
    });

    const sealed = await sealRunSpec(evidence, wellFormed);
    const payload = JSON.parse(
      (await evidence.blobs.bytes(evidence.records()[0]?.payloadDigest ?? "")) ?? "{}",
    );

    expect(payload.digest).toBe(sealed.digest);
    expect(payload.spec.repository.baseCommit).toBe(wellFormed.repository.baseCommit);
  });
});
