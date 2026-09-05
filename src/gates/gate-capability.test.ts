import { describe, expect, it } from "vitest";
import { assembleGates } from "./default-gates.ts";
import { capabilityOf, isClassified } from "./gate-capability.ts";
import type { GateCycle } from "./gate-runner.ts";
import { executedTheChange, isGreen } from "./gate-runner.ts";

/**
 * A lint run and a test run are both a command the harness spawned. They establish different
 * things, and treating them alike is how a change nothing executed reads green: linting proves
 * the source parses and says nothing about whether the code was ever run.
 */
function cycleWith(runs: readonly { id: string; kind: string; status: string }[]): GateCycle {
  return {
    attempt: 1,
    runs: runs.map((run) => ({
      gateId: run.id,
      title: run.id,
      severity: "blocking" as const,
      status: run.status as never,
      blocking: true,
      detail: "",
      kind: run.kind as never,
      record: `sha256:${"ab".repeat(32)}`,
      capability: capabilityOf(run.id),
    })),
    blockingFailures: runs.filter((run) => run.status === "failed").map((run) => run.id),
    measures: { changedFiles: 3 },
    statuses: {},
    coverageReports: [],
    testReports: [],
  } as unknown as GateCycle;
}

describe("what a passing gate establishes about changed code", () => {
  it("does not read a lint-only pass as having executed the change", () => {
    const cycle = cycleWith([
      { id: "lint", kind: "command", status: "passed" },
      { id: "typecheck", kind: "command", status: "passed" },
      { id: "tests", kind: "command", status: "not-applicable" },
    ]);

    expect(executedTheChange(cycle)).toBe(false);
    expect(isGreen(cycle)).toBe(false);
  });

  it("reads a passing test run as having executed the change", () => {
    const cycle = cycleWith([
      { id: "lint", kind: "command", status: "passed" },
      { id: "tests", kind: "command", status: "passed" },
    ]);

    expect(executedTheChange(cycle)).toBe(true);
    expect(isGreen(cycle)).toBe(true);
  });

  it("does not read a failed test run as having executed the change into a pass", () => {
    const cycle = cycleWith([{ id: "tests", kind: "command", status: "failed" }]);

    expect(isGreen(cycle)).toBe(false);
  });

  it("classifies every assembled gate by name, so none is defaulted into static", () => {
    // Falling to static is the safe direction and is still a guess. A gate added without a
    // classification fails here rather than quietly deciding it executes nothing.
    const gates = assembleGates({
      types: ["node"],
      nodeScriptCommands: { test: "node --test", lint: "eslint ." },
    } as never);

    expect(gates.length).toBeGreaterThan(0);
    for (const gate of gates) {
      expect({ id: gate.id, classified: isClassified(gate.id) }).toEqual({
        id: gate.id,
        classified: true,
      });
    }
  });

  it("calls the tests gate dynamic and the source-reading gates static", () => {
    expect(capabilityOf("tests")).toBe("dynamic");
    expect(capabilityOf("tests:python")).toBe("dynamic");
    expect(capabilityOf("lint")).toBe("static");
    expect(capabilityOf("typecheck")).toBe("static");
    expect(capabilityOf("secret-scan")).toBe("policy");
  });
});
