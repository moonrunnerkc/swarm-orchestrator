import { describe, expect, it } from "vitest";
import type { GateObservation } from "./gate-definition.ts";
import {
  exitCodeParser,
  inspectionParser,
  parseUncoveredLines,
  testOutputParser,
  vitestTestParser,
} from "./parsers.ts";

function observed(partial: Partial<GateObservation>): GateObservation {
  return {
    exitCode: partial.exitCode ?? 0,
    stdout: partial.stdout ?? "",
    stderr: partial.stderr ?? "",
    durationMs: partial.durationMs ?? 1,
    unavailable: partial.unavailable ?? null,
  };
}

const tapOutput = [
  "TAP version 13",
  "# Subtest: adds",
  "ok 1 - adds",
  "# Subtest: skipped",
  "ok 2 - skipped # SKIP",
  "1..2",
  "# tests 2",
  "# pass 1",
  "# fail 0",
  "# skipped 1",
].join("\n");

describe("gate output parsers", () => {
  it("reads the counters out of a TAP run", () => {
    const reading = testOutputParser(observed({ stdout: tapOutput }));

    expect(reading.status).toBe("passed");
    expect(reading.measures).toEqual({
      testsCollected: 2,
      testsPassed: 1,
      testsFailed: 0,
      testsSkipped: 1,
    });
  });

  it("calls a TAP run failed when it reports a failure, whatever the exit code was", () => {
    const reading = testOutputParser(
      observed({ exitCode: 0, stdout: tapOutput.replace("# fail 0", "# fail 1") }),
    );

    expect(reading.status).toBe("failed");
    expect(reading.measures.testsFailed).toBe(1);
  });

  it("reads vitest's summary line", () => {
    const reading = vitestTestParser(
      observed({ exitCode: 1, stdout: " Tests  2 failed | 194 passed (196)\n" }),
    );

    expect(reading.status).toBe("failed");
    expect(reading.measures).toEqual({ testsCollected: 196, testsPassed: 194, testsFailed: 2 });
  });

  it("falls back to the exit code rather than inventing a count", () => {
    const reading = testOutputParser(observed({ exitCode: 1, stdout: "something else entirely" }));

    expect(reading.status).toBe("failed");
    expect(reading.measures).toEqual({});
  });

  it("reports a gate whose tool is missing as not applicable, never as a failure", () => {
    const reading = exitCodeParser(
      observed({ exitCode: 127, stderr: "/bin/sh: mypy: command not found" }),
    );

    expect(reading.status).toBe("not-applicable");
    expect(reading.detail).toContain("not installed");
  });

  it("reports a gate that could not run at all as not applicable", () => {
    const reading = exitCodeParser(
      observed({ unavailable: "package.json declares no lint script" }),
    );

    expect(reading.status).toBe("not-applicable");
    expect(reading.detail).toBe("package.json declares no lint script");
  });

  it("reads an inspection's own JSON, and fails it when that JSON is unreadable", () => {
    const good = inspectionParser(
      observed({
        exitCode: 1,
        stdout: JSON.stringify({ detail: "two markers", measures: { placeholdersIntroduced: 2 } }),
      }),
    );
    expect(good).toEqual({
      status: "failed",
      detail: "two markers",
      measures: { placeholdersIntroduced: 2 },
    });

    expect(inspectionParser(observed({ stdout: "not json" })).status).toBe("failed");
  });
});

describe("reading a coverage report", () => {
  it("takes the uncovered line ranges out of the node runner's table", () => {
    const uncovered = parseUncoveredLines(
      [
        "# start of coverage report",
        "# ------------------------------------------",
        "# file      | line % | branch % | funcs % | uncovered lines",
        "# ------------------------------------------",
        "# math.js   |  66.67 |    66.67 |  100.00 | 3-4",
        "# util.js   |  80.00 |   100.00 |  100.00 | 7, 11-12",
        "# all files |  70.00 |    80.00 |  100.00 | ",
        "# ------------------------------------------",
        "# end of coverage report",
      ].join("\n"),
    );

    expect([...(uncovered.get("math.js") ?? [])]).toEqual([3, 4]);
    expect([...(uncovered.get("util.js") ?? [])]).toEqual([7, 11, 12]);
    expect(uncovered.has("all files")).toBe(false);
  });

  it("finds nothing in output that carries no coverage report", () => {
    expect(parseUncoveredLines(tapOutput).size).toBe(0);
  });
});
