import { describe, expect, it } from "vitest";
import { capabilityOf } from "./gate-capability.ts";
import {
  describeFailuresForModel,
  excerptForModel,
  type GateCycle,
  isGreen,
} from "./gate-runner.ts";

function cycleWith(options: {
  changedFiles: number;
  testsStatus: "passed" | "not-applicable" | "failed";
  testsStdout?: string;
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
      observation: {
        exitCode: status === "failed" ? 3 : 0,
        stdout: gateId === "tests" ? (options.testsStdout ?? "") : "",
        stderr: "",
        durationMs: 0,
        unavailable: null,
      },
      coverageReport: null,
      record: "sha256:aa",
    }) as unknown as GateCycle["runs"][number];

  return {
    attempt: 0,
    runs: [run("tests", "command", options.testsStatus), run("file-set", "inspection", "passed")],
    statuses: { tests: options.testsStatus, "file-set": "passed" },
    blockingFailures:
      options.testsStatus === "failed" ? [run("tests", "command", options.testsStatus)] : [],
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

  it("does not certify an unusable required test command on an unchanged tree", () => {
    expect(isGreen(cycleWith({ changedFiles: 0, testsStatus: "not-applicable" }))).toBe(false);
  });
});

describe("a repair brief over a failing test command", () => {
  it("does not say nothing ran over a change its tests just failed on", () => {
    const told = describeFailuresForModel(cycleWith({ changedFiles: 1, testsStatus: "failed" }));
    expect(told).not.toContain("Nothing ran over this change");
    expect(told).toContain("gate tests (tests) FAILED");
  });

  it("keeps the end of a long runner output, where its failures are reported", () => {
    // mocha's spec reporter: every passing title first, the failures last.
    const passing = Array.from({ length: 1200 }, (_, index) => `    ✔ passing test ${index}`);
    const stdout = [
      ...passing,
      "  1238 passing (5s)",
      "  3 failing",
      "  1) parse-args",
      "       allows -j 4:",
      "     TypeError: Mocha flag '-j' given invalid option: '4'",
    ].join("\n");
    const told = describeFailuresForModel(
      cycleWith({ changedFiles: 1, testsStatus: "failed", testsStdout: stdout }),
    );
    expect(told).toContain("Mocha flag '-j' given invalid option: '4'");
    expect(told).toContain("characters omitted from the middle");
    expect(told.length).toBeLessThan(9_000);
    expect(excerptForModel("short output")).toBe("short output");
  });
});
