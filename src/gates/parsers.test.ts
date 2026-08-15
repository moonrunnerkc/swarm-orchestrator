import { describe, expect, it } from "vitest";
import type { GateObservation } from "./gate-definition.ts";
import {
  exitCodeParser,
  fileLineHits,
  inspectionParser,
  parseLineHits,
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
  const mathSection = [
    "TN:",
    "SF:/build/src/math.ts",
    "FNF:1",
    "DA:1,1",
    "DA:2,0",
    "DA:3,0",
    "DA:4,2",
    "LF:4",
    "LH:2",
    "end_of_record",
  ];

  it("takes the hit count of every reported line out of an lcov report", () => {
    const hits = parseLineHits(
      [...mathSection, "SF:/build/src/util.ts", "DA:1,1", "LF:1", "LH:1", "end_of_record"].join(
        "\n",
      ),
    );

    // Per line, hits and all: a line the report named as reached, a line it named as missed,
    // and a line it did not name are three different things, and only the first is coverage.
    expect([...(hits.get("/build/src/math.ts") ?? [])]).toEqual([
      [1, 1],
      [2, 0],
      [3, 0],
      [4, 2],
    ]);
    expect(hits.get("/build/src/math.ts")?.get(9)).toBeUndefined();
    expect([...(hits.get("/build/src/util.ts") ?? [])]).toEqual([[1, 1]]);
  });

  it("finds nothing in output that carries no coverage report", () => {
    expect(parseLineHits(tapOutput).size).toBe(0);
  });

  it("reads nothing out of an artifact that is not a complete lcov report", () => {
    for (const artifact of [
      "",
      "SF:/build/src/math.ts\n",
      "SF:/build/src/math.ts\nend_of_record\n",
      "SF:/build/src/math.ts\nDA:1,1\nend_of_record\n",
      "SF:/build/src/math.ts\nDA:1,1\nLF:2\nLH:1\nend_of_record\n",
      "SF:/build/src/math.ts\nDA:1,0\nLF:1\nLH:1\nend_of_record\n",
      "DA:1,1\nLF:1\nLH:1\nend_of_record\n",
      [
        "start of coverage report",
        "file | line % | branch % | funcs % | uncovered lines",
        "math.js | 100.00 | 100.00 | 100.00 | ",
        "end of coverage report",
      ].join("\n"),
      [...mathSection, "the runner also printed this"].join("\n"),
    ]) {
      expect({ artifact, files: parseLineHits(artifact).size }).toEqual({
        artifact,
        files: 0,
      });
    }
  });

  it("merges every section that resolves to one file, so an empty one cannot shadow it", () => {
    const hits = parseLineHits(
      [
        "SF:src/math.ts",
        "DA:1,1",
        "DA:2,1",
        "LF:2",
        "LH:2",
        "end_of_record",
        "SF:/workspace/src/math.ts",
        "DA:2,0",
        "DA:3,0",
        "LF:2",
        "LH:0",
        "end_of_record",
      ].join("\n"),
    );
    const merged = fileLineHits(hits, "src/math.ts", "/workspace");

    // The relative spelling and the absolute one resolve to one file, and where they disagree
    // about a line the lower count stands: one section saying it was never reached is enough.
    expect([...(merged ?? [])]).toEqual([
      [1, 1],
      [2, 0],
      [3, 0],
    ]);
    expect(fileLineHits(hits, "src/other.ts", "/workspace")).toBeNull();
  });

  it("does not let a section for another file report itself as coverage of this one", () => {
    const hits = parseLineHits(
      [
        "SF:vendor/math.ts",
        "DA:1,1",
        "LF:1",
        "LH:1",
        "end_of_record",
        "SF:/opt/other/math.ts",
        "DA:1,1",
        "LF:1",
        "LH:1",
        "end_of_record",
      ].join("\n"),
    );

    // Same basename, same suffix, different file. Nothing here measured src/math.ts.
    expect(fileLineHits(hits, "src/math.ts", "/workspace")).toBeNull();
    expect(fileLineHits(hits, "math.ts", "/workspace")).toBeNull();
    // And with no root to resolve against, the two spellings have to agree by themselves.
    expect(fileLineHits(hits, "math.ts")).toBeNull();
    expect(fileLineHits(hits, "vendor/math.ts")).not.toBeNull();
  });
});
