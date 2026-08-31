import { describe, expect, it } from "vitest";
import type { GateObservation } from "./gate-definition.ts";
import {
  exitCodeParser,
  fileLineHits,
  inspectionParser,
  parseLineHits,
  parseTapOutcomes,
  parseTapTotals,
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
    const sections = parseLineHits(
      [...mathSection, "SF:/build/src/util.ts", "DA:1,1", "LF:1", "LH:1", "end_of_record"].join(
        "\n",
      ),
    );

    // Per line, hits and all: a line the report named as reached, a line it named as missed,
    // and a line it did not name are three different things, and only the first is coverage.
    expect(sections.map((section) => section.file)).toEqual([
      "/build/src/math.ts",
      "/build/src/util.ts",
    ]);
    expect([...(sections[0]?.hits ?? [])]).toEqual([
      [1, 1],
      [2, 0],
      [3, 0],
      [4, 2],
    ]);
    expect(sections[0]?.hits.get(9)).toBeUndefined();
    expect([...(sections[1]?.hits ?? [])]).toEqual([[1, 1]]);
  });

  it("finds nothing in output that carries no coverage report", () => {
    expect(parseLineHits(tapOutput)).toEqual([]);
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
      expect({ artifact, sections: parseLineHits(artifact).length }).toEqual({
        artifact,
        sections: 0,
      });
    }
  });

  it("reads one file's coverage out of the one section that reported it", () => {
    const sections = parseLineHits(
      ["SF:src/math.ts", "DA:1,1", "DA:2,0", "DA:3,0", "LF:3", "LH:1", "end_of_record"].join("\n"),
    );

    expect([...(fileLineHits(sections, "src/math.ts", "/workspace") ?? [])]).toEqual([
      [1, 1],
      [2, 0],
      [3, 0],
    ]);
    expect(fileLineHits(sections, "src/other.ts", "/workspace")).toBeNull();
  });

  /**
   * This assertion used to run the other way: sections naming one file were merged, taking the
   * lower count where they disagreed, so that a section with nothing to say could not shadow
   * one with misses to report. Merging is what a second section needs. Two complete sections
   * for one file, the first naming line 1 and the second naming lines 2 through 9, unioned
   * their line numbers and read as nine lines measured and nine reached, which is a
   * measurement of one line and a claim about eight. Abstaining is stricter than either
   * reading and it keeps what the merge was there for.
   */
  it("abstains where more than one section names one file, rather than combining them", () => {
    const split = parseLineHits(
      [
        "SF:clamp.mjs",
        "DA:1,1",
        "LF:1",
        "LH:1",
        "end_of_record",
        "SF:clamp.mjs",
        ...Array.from({ length: 8 }, (_unused, index) => `DA:${index + 2},1`),
        "LF:8",
        "LH:8",
        "end_of_record",
      ].join("\n"),
    );

    expect(split).toHaveLength(2);
    expect(fileLineHits(split, "clamp.mjs", "/workspace")).toBeNull();
  });

  it("abstains just the same where the second section spells the path another way", () => {
    const spellings = parseLineHits(
      [
        "SF:src/math.ts",
        "DA:1,1",
        "LF:1",
        "LH:1",
        "end_of_record",
        "SF:/workspace/src/math.ts",
        "DA:2,1",
        "DA:3,1",
        "LF:2",
        "LH:2",
        "end_of_record",
      ].join("\n"),
    );

    expect(fileLineHits(spellings, "src/math.ts", "/workspace")).toBeNull();
  });

  it("does not let a section for another file report itself as coverage of this one", () => {
    const sections = parseLineHits(
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
    expect(fileLineHits(sections, "src/math.ts", "/workspace")).toBeNull();
    expect(fileLineHits(sections, "math.ts", "/workspace")).toBeNull();
    // And with no root to resolve against, the two spellings have to agree by themselves.
    expect(fileLineHits(sections, "math.ts")).toBeNull();
    expect(fileLineHits(sections, "vendor/math.ts")).not.toBeNull();
  });
});

describe("which tests a run attributed", () => {
  it("reads the run's own result points, at any depth a suite reports them", () => {
    expect(
      parseTapOutcomes(
        [
          "TAP version 13",
          "1..2",
          "ok 1 - adds",
          "not ok 2 - suite",
          "    not ok 1 - inner",
          "",
        ].join("\n"),
      ),
    ).toEqual({ passed: ["adds"], failed: ["suite", "inner"] });
  });

  /**
   * A test the runner marked skipped did not run, so the run says nothing about that name
   * either way. Dropping the skipped point alone left the name uncontested, and a subtest
   * reusing it supplied the only result point carrying it: node writes `not ok 1 - innocentNew`
   * for the subtest, and the escape hatch read that as the top-level innocentNew failing on the
   * base source, which is what pays for a deletion.
   */
  it("attributes nothing to a name the run reported as skipped", () => {
    const stolen = parseTapOutcomes(
      [
        "TAP version 13",
        "1..2",
        "ok 1 - innocentNew # SKIP",
        "ok 2 - attacker",
        "    not ok 1 - innocentNew",
        "",
      ].join("\n"),
    );

    expect(stolen?.failed ?? []).not.toContain("innocentNew");
    expect(stolen?.passed ?? []).not.toContain("innocentNew");
    expect(stolen?.passed).toEqual(["attacker"]);
  });

  it("holds the same way round, so a passing subtest cannot claim a skipped name either", () => {
    const outcomes = parseTapOutcomes(
      [
        "TAP version 13",
        "1..2",
        "ok 1 - innocentNew # SKIP",
        "not ok 2 - attacker",
        "    ok 1 - innocentNew",
        "",
      ].join("\n"),
    );

    expect(outcomes?.passed ?? []).not.toContain("innocentNew");
    expect(outcomes?.failed).toEqual(["attacker"]);
  });

  it("still names a test that really failed beside a skipped one", () => {
    expect(
      parseTapOutcomes(
        ["TAP version 13", "1..2", "ok 1 - later # SKIP", "not ok 2 - multiplies", ""].join("\n"),
      ),
    ).toEqual({ passed: [], failed: ["multiplies"] });
  });
});

describe("parseTapTotals", () => {
  const run = (points: readonly string[], plan: number) =>
    ["TAP version 13", ...points, `1..${plan}`].join("\n");

  it("counts the result points a run reported", () => {
    expect(parseTapTotals(run(["ok 1 - a", "not ok 2 - b"], 2))).toEqual({
      collected: 2,
      skipped: 0,
    });
  });

  it("counts a subtest, because deleting one is the move being held against", () => {
    const text = run(["ok 1 - suite", "  ok 1 - inner", "  ok 2 - other"], 1);

    expect(parseTapTotals(text)?.collected).toBe(3);
  });

  it("counts a skipped point as skipped", () => {
    expect(parseTapTotals(run(["ok 1 - a", "ok 2 - b # SKIP nope"], 2))).toEqual({
      collected: 2,
      skipped: 1,
    });
  });

  it("ignores what a test printed, which arrives as a comment", () => {
    const text = [
      "TAP version 13",
      "# \\# tests 999",
      "# ok 500 - a test that never ran",
      "ok 1 - the only real one",
      "1..1",
      "# tests 1",
    ].join("\n");

    expect(parseTapTotals(text)).toEqual({ collected: 1, skipped: 0 });
  });

  it("refuses a document whose plan disagrees with its own top-level points", () => {
    // Fail closed: a run that cannot account for itself measures nothing, and the ratchet
    // abstains on a null rather than comparing a number nobody can stand behind.
    expect(parseTapTotals(run(["ok 1 - a"], 7))).toBeNull();
  });

  it("refuses a document with no plan at all", () => {
    expect(parseTapTotals("TAP version 13\nok 1 - a\n")).toBeNull();
  });

  it("refuses text that is not a TAP run", () => {
    expect(parseTapTotals("Tests  4 passed (4)\n")).toBeNull();
  });
});
