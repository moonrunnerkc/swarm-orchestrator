import { describe, expect, it } from "vitest";
import { analyzeRecord, armSummary, stageAGate } from "./analyze.mjs";

const digest = (n) => `sha256:${"0".repeat(63)}${n}`;

function record(overrides = {}) {
  return {
    schema: "swarm-ordinary-comparison.record.v1",
    manifestDigest: digest(1),
    task: "repo-bugfix-thing",
    arm: "swarm",
    order: 0,
    startedAt: "2026-10-15T01:00:00.000Z",
    endedAt: "2026-10-15T01:10:00.000Z",
    host: { platform: "darwin", arch: "arm64", node: "v24.15.0" },
    versions: {
      swarmRevision: "abc",
      opencode: "1.14.48",
      model: "qwen3.8:27b",
      endpoint: "http://127.0.0.1:8000/v1",
      endpointInstance: "1 x",
    },
    preparation: { wallMs: 30_000, ok: true, detail: "" },
    invocations: [
      {
        kind: "initial",
        correction: 0,
        argv: ["node"],
        exitCode: 0,
        signal: null,
        wallMs: 300_000,
        // No blob behind this digest: the classification then reads an empty stdout.
        stdoutDigest: digest(9),
        stderrDigest: digest(9),
        tokens: 1000,
        claimedSuccess: true,
        visible: { checkExit: 0, projectTestExit: 0, passed: true, detailDigest: digest(9) },
      },
    ],
    corrections: 0,
    resolvedVisible: true,
    finalPatchDigest: digest(2),
    finalPatchBytes: 10,
    hidden: { verdict: "pass", basis: "all passed", detailDigest: digest(9) },
    oracleExposure: "no mention of the sealed commit or mirror in 1 evidence director(ies)",
    totals: { agentWallMs: 300_000, tokens: 1000, tokensUnknownInvocations: 0 },
    infrastructureFailure: null,
    notes: [],
    ...overrides,
  };
}

describe("analyzeRecord keeps a correct patch apart from a delivered task", () => {
  it("does not deliver a Swarm run whose verdict line is missing even when the oracle passed", () => {
    const row = analyzeRecord(record());
    expect(row.correctPatch).toBe(true);
    expect(row.delivered).toBe(false);
    expect(row.notDeliveredBecause.join(" ")).toMatch(/no acceptable verdict/);
  });

  it("reports exit 1 as a reported non-acceptance, never a false claim", () => {
    const row = analyzeRecord(
      record({
        invocations: [{ ...record().invocations[0], exitCode: 1, claimedSuccess: false }],
      }),
    );
    expect(row.correctPatch).toBe(true);
    expect(row.claim).toBe("reports-not-acceptable");
    expect(row.falseClaim).toBe(false);
    expect(row.delivered).toBe(false);
  });

  it("reads a wall kill as not finishing normally and as time, not a claim", () => {
    const row = analyzeRecord(
      record({
        invocations: [{ ...record().invocations[0], exitCode: null, signal: "SIGKILL(deadline)" }],
        hidden: { verdict: "fail", basis: "hidden tests exited 1", detailDigest: digest(9) },
      }),
    );
    expect(row.claim).toBe("killed");
    expect(row.delivered).toBe(false);
    expect(row.notDeliveredBecause).toContain("killed at the wall (SIGKILL(deadline))");
  });

  it("splits the launch's time into agent, preparation and scoring without overlap", () => {
    const row = analyzeRecord(record());
    expect(row.time.elapsedMs).toBe(600_000);
    expect(row.time.agentMs + row.time.preparationMs + row.time.scoringAndHarnessMs).toBe(600_000);
  });

  it("marks an OpenCode run with no answer as no-answer, not a claim", () => {
    const row = analyzeRecord(record({ arm: "opencode" }));
    expect(row.claim).toBe("no-answer");
    expect(row.falseClaim).toBe(false);
  });
});

describe("armSummary and the stage A gate", () => {
  it("leaves cost per delivery undefined at zero deliveries", () => {
    const summary = armSummary([analyzeRecord(record())]);
    expect(summary.deliveries).toBe(0);
    expect(summary.correctPatches).toBe(1);
    expect(summary.costPerDelivery.agentMinutes).toBe("undefined (zero deliveries)");
  });

  it("does not qualify stage A when fewer than eight launches are valid", () => {
    const gate = stageAGate(
      [analyzeRecord(record())],
      [{ id: "repo-bugfix-thing", workType: "bugfix" }],
    );
    expect(gate.qualifies).toBe(false);
    expect(gate.items[0].holds).toBe(false);
  });
});
