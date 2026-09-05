import { describe, expect, it } from "vitest";
import { capabilityOf } from "./gate-capability.ts";
import { describeFailuresForModel, type GateCycle, isGreen } from "./gate-runner.ts";

function cycleWith(options: {
  changedFiles: number;
  testsStatus: "passed" | "not-applicable";
}): GateCycle {
  const run = (gateId: string, kind: "command" | "inspection", status: string) =>
    ({
      gateId,
      kind,
      title: gateId,
      severity: "blocking" as const,
      capability: capabilityOf(gateId),
      status,
      detail: gateId === "tests" ? "0 collected: the command found no tests to run" : "fine",
      measures: {},
      observation: { exitCode: 0, stdout: "", stderr: "", durationMs: 0, unavailable: null },
      coverageReport: null,
      record: "sha256:aa",
    }) as unknown as GateCycle["runs"][number];

  return {
    attempt: 0,
    runs: [run("tests", "command", options.testsStatus), run("file-set", "inspection", "passed")],
    statuses: { tests: options.testsStatus, "file-set": "passed" },
    blockingFailures: [],
    advisoryFailures: [],
    measures: { changedFiles: options.changedFiles },
    coverageReports: [],
  } as unknown as GateCycle;
}

describe("a change no command gate ran over", () => {
  it("is not green, so the loop that fixes things gets a turn at it", () => {
    // It reported the failure accurately and did nothing about it: the resolve loop reads
    // isGreen, and abstention is not a blocking failure, so the model was never asked.
    expect(isGreen(cycleWith({ changedFiles: 3, testsStatus: "not-applicable" }))).toBe(false);
  });

  it("tells the model what to do about it, since no gate has bytes to quote", () => {
    const told = describeFailuresForModel(
      cycleWith({ changedFiles: 3, testsStatus: "not-applicable" }),
    );

    expect(told).toContain("Nothing ran over this change");
    expect(told).toContain("3 file(s)");
    expect(told).toContain("declared test command");
  });

  it("is green once something actually ran", () => {
    expect(isGreen(cycleWith({ changedFiles: 3, testsStatus: "passed" }))).toBe(true);
  });

  it("leaves a tree nothing touched alone, where there is nothing to run over", () => {
    expect(isGreen(cycleWith({ changedFiles: 0, testsStatus: "not-applicable" }))).toBe(true);
  });
});
