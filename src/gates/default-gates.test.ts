import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { openEvidenceSession } from "../evidence/session.ts";
import { assembleGates } from "./default-gates.ts";
import { runGateCycle } from "./gate-runner.ts";
import { processIsolation } from "./node-test-command.ts";
import type { ProjectDetection } from "./project-type.ts";
import { createMemoryWorkspace, createStubCommandRunner } from "./test-doubles.ts";

/**
 * The coverage arm spawns node's own runner with `--test-isolation=process`, which Node 22
 * rejects as a bad option. On that runtime the tests gate has to keep running the project's
 * own command, and the arm has to say why it measured nothing, because an abstention with no
 * reason reads like a runner that wrote no report rather than a harness that could not ask.
 */
const nodeProject: ProjectDetection = {
  types: ["node"],
  manifests: ["package.json"],
  nodeScripts: ["test"],
  nodeScriptCommands: { test: "node --test" },
  pythonTools: [],
};

function testsGate(nodeVersion: string) {
  const gate = assembleGates(nodeProject, { nodeVersion }).find((one) => one.id === "tests");
  if (gate === undefined || gate.source.kind !== "command") {
    throw new Error("the node project assembles a tests command gate");
  }
  return gate.source;
}

describe("the tests gate on a Node that accepts process isolation", () => {
  it("asks node's runner for the harness reports", () => {
    const source = testsGate("v24.15.0");

    expect(source.argv).toContain(processIsolation);
    expect(source.coverageUnmeasured).toBeUndefined();
  });
});

describe("the tests gate on a Node below the isolated coverage floor", () => {
  it("keeps the project's own command and names why coverage is unmeasured", () => {
    const source = testsGate("v22.22.3");

    expect(source.argv).toBeUndefined();
    expect(source.command).toBe("npm run --silent test");
    expect(source.coverageUnmeasured).toContain(
      "node version below the floor for isolated coverage",
    );
    expect(source.coverageUnmeasured).toContain("v22.22.3");
  });

  it("says nothing about coverage for a runner the harness could not have asked anyway", () => {
    const source = assembleGates(
      { ...nodeProject, nodeScriptCommands: { test: "vitest run" } },
      { nodeVersion: "v22.22.3" },
    ).find((one) => one.id === "tests")?.source;

    expect(source?.kind === "command" ? source.coverageUnmeasured : null).toBeUndefined();
  });
});

describe("what a cycle carries about unmeasured coverage", () => {
  let outside = "";

  beforeEach(async () => {
    outside = await mkdtemp(join(tmpdir(), "swarm-coverage-floor-"));
  });

  afterEach(async () => {
    await rm(outside, { recursive: true, force: true });
  });

  it("names the reason on the cycle and in the gate-run record", async () => {
    const probe = createMemoryWorkspace({
      base: { "a.mjs": "export const a = 1;\n" },
      current: { "a.mjs": "export const a = 2;\n" },
    });
    const evidence = await openEvidenceSession({
      root: join(outside, "sessions"),
      sessionId: "coverage-floor",
      clock: createTestClock(1),
    });
    const gates = assembleGates(nodeProject, { nodeVersion: "v22.22.3" }).filter(
      (gate) => gate.id === "tests",
    );

    const cycle = await runGateCycle(
      gates,
      {
        workspaceRoot: outside,
        changes: await probe.changes(),
        fileSet: {
          declared: ["a.mjs"],
          amendments: [],
          allowed: new Set(["a.mjs"]),
          wasDeclared: true,
          editedBeforeAuthorized: [],
        },
        budgets: { maxChangedFiles: 12, maxAddedLines: 600 },
        probe,
      },
      0,
      {
        commands: createStubCommandRunner(() => ({ exitCode: 0, stdout: "ok 1\n1..1\n" })),
        evidence,
        emit: () => undefined,
      },
    );

    expect(cycle.coverageReports).toEqual([]);
    expect(cycle.coverageUnmeasured).toHaveLength(1);
    expect(cycle.coverageUnmeasured[0]).toContain(
      "node version below the floor for isolated coverage",
    );
    const record = evidence.records().find((entry) => entry.type === "gate-run");
    const payload = evidence.payloads().get(record?.payloadDigest ?? "") as {
      coverageUnmeasured?: unknown;
    };
    expect(payload.coverageUnmeasured).toBe(cycle.coverageUnmeasured[0]);
  });
});
