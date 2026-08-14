import { describe, expect, it } from "vitest";
import type { GateStatus } from "../core/loop-events.ts";
import { emptyMeasureSnapshot, type MeasureSnapshot } from "./measure-snapshot.ts";
import type { TestFileMeasures } from "./measures.ts";
import { judgeRatchet, type RatchetInput, ratchetPayload } from "./ratchet.ts";

function measures(partial: Partial<TestFileMeasures> = {}): TestFileMeasures {
  return {
    tests: partial.tests ?? 1,
    assertions: partial.assertions ?? 1,
    skips: partial.skips ?? 0,
    exactSubjects: partial.exactSubjects ?? [],
    assertionsBySubject: partial.assertionsBySubject ?? {},
  };
}

function snapshot(
  perTestFile: Record<string, TestFileMeasures>,
  extra: Partial<MeasureSnapshot> = {},
): MeasureSnapshot {
  return { ...emptyMeasureSnapshot, ...extra, perTestFile };
}

function input(overrides: Partial<RatchetInput>): RatchetInput {
  const gates: Record<string, GateStatus> = { tests: "passed", lint: "passed" };
  return {
    baselineGates: gates,
    candidateGates: gates,
    baseline: snapshot({}),
    candidate: snapshot({}),
    exemptFiles: new Set(),
    ...overrides,
  };
}

describe("the numeric ratchet", () => {
  it("accepts an attempt where nothing moved the wrong way", () => {
    const decision = judgeRatchet(
      input({
        baseline: snapshot({ "a.test.ts": measures({ tests: 2, assertions: 4 }) }),
        candidate: snapshot({ "a.test.ts": measures({ tests: 3, assertions: 6 }) }),
      }),
    );

    expect(decision.accepted).toBe(true);
    expect(decision.violations).toEqual([]);
  });

  it("rejects an attempt that regresses a gate which was passing", () => {
    const decision = judgeRatchet(
      input({
        baselineGates: { tests: "passed", lint: "passed" },
        candidateGates: { tests: "passed", lint: "failed" },
      }),
    );

    expect(decision.accepted).toBe(false);
    expect(decision.violations.map((violation) => violation.kind)).toEqual(["gate-regressed"]);
    expect(decision.violations[0]?.detail).toContain("lint");
  });

  it("does not count a gate that was already failing as a regression", () => {
    const decision = judgeRatchet(
      input({
        baselineGates: { tests: "failed" },
        candidateGates: { tests: "failed" },
      }),
    );

    expect(decision.accepted).toBe(true);
  });

  it("rejects the retry that holds the tests gate green by deleting the failing tests", () => {
    const decision = judgeRatchet(
      input({
        // The boolean gate went from red to green, which is exactly what makes this the
        // patch a capped retry loop produces. The numbers say what happened.
        baselineGates: { tests: "failed" },
        candidateGates: { tests: "passed" },
        baseline: snapshot(
          { "math.test.ts": measures({ tests: 4, assertions: 9 }) },
          { testsCollected: 4 },
        ),
        candidate: snapshot(
          { "math.test.ts": measures({ tests: 0, assertions: 0 }) },
          { testsCollected: 0 },
        ),
      }),
    );

    expect(decision.accepted).toBe(false);
    expect(decision.violations.map((violation) => violation.kind)).toEqual([
      "tests-declared-decreased",
      "assertions-decreased",
      "tests-collected-decreased",
    ]);
  });

  it("rejects an attempt that adds a skip marker", () => {
    const decision = judgeRatchet(
      input({
        baseline: snapshot({ "a.test.ts": measures({ skips: 0 }) }),
        candidate: snapshot({ "a.test.ts": measures({ skips: 1 }) }),
      }),
    );

    expect(decision.accepted).toBe(false);
    expect(decision.violations[0]?.kind).toBe("skip-markers-increased");
  });

  it("rejects an attempt that lowers coverage of changed lines", () => {
    const decision = judgeRatchet(
      input({
        baseline: snapshot({}, { changedLineCoverage: 0.9 }),
        candidate: snapshot({}, { changedLineCoverage: 0.5 }),
      }),
    );

    expect(decision.accepted).toBe(false);
    expect(decision.violations[0]?.kind).toBe("changed-line-coverage-decreased");
    expect(decision.violations[0]?.detail).toContain("90.0%");
  });

  it("abstains by name on a measure nothing produced, rather than reading it as unchanged", () => {
    const decision = judgeRatchet(
      input({
        baseline: snapshot({}, { changedLineCoverage: null, testsCollected: null }),
        candidate: snapshot({}, { changedLineCoverage: null, testsCollected: null }),
      }),
    );

    expect(decision.accepted).toBe(true);
    expect(decision.abstentions.map((abstention) => abstention.measure).sort()).toEqual([
      "changedLineCoverage",
      "testsCollected",
    ]);
  });

  it("abstains when a measure exists on only one side of the attempt", () => {
    const decision = judgeRatchet(
      input({
        baseline: snapshot({}, { testsCollected: 12 }),
        candidate: snapshot({}, { testsCollected: null }),
      }),
    );

    expect(decision.accepted).toBe(true);
    expect(decision.abstentions[0]?.reason).toContain("only one side");
  });

  it("allows an assertion drop that a new exact-match assertion on the same subject explains", () => {
    const decision = judgeRatchet(
      input({
        baseline: snapshot({
          "a.test.ts": measures({
            tests: 1,
            assertions: 3,
            exactSubjects: [],
            assertionsBySubject: { result: 3 },
          }),
        }),
        candidate: snapshot({
          // Three loose assertions on one subject consolidated into one exact-match assertion.
          "a.test.ts": measures({
            tests: 1,
            assertions: 1,
            exactSubjects: ["result"],
            assertionsBySubject: { result: 1 },
          }),
        }),
      }),
    );

    expect(decision.accepted).toBe(true);
  });

  it("still rejects a drop the exact-match allowance does not cover", () => {
    const decision = judgeRatchet(
      input({
        baseline: snapshot({
          "a.test.ts": measures({
            tests: 1,
            assertions: 9,
            exactSubjects: [],
            assertionsBySubject: { result: 2, other: 7 },
          }),
        }),
        candidate: snapshot({
          "a.test.ts": measures({
            tests: 1,
            assertions: 1,
            exactSubjects: ["result"],
            assertionsBySubject: { result: 1 },
          }),
        }),
      }),
    );

    expect(decision.accepted).toBe(false);
    expect(decision.violations[0]?.detail).toContain("only 1 of that drop is explained");
  });
});

describe("the ratchet escape hatch", () => {
  it("drops an exempt file out of both sides of the comparison", () => {
    const judged = input({
      baseline: snapshot({
        "spec.test.ts": measures({ tests: 2, assertions: 5 }),
        "other.test.ts": measures({ tests: 1, assertions: 1 }),
      }),
      candidate: snapshot({
        "spec.test.ts": measures({ tests: 1, assertions: 1 }),
        "other.test.ts": measures({ tests: 1, assertions: 1 }),
      }),
      exemptFiles: new Set(["spec.test.ts"]),
    });

    expect(judgeRatchet(judged).accepted).toBe(true);
    expect(judgeRatchet({ ...judged, exemptFiles: new Set() }).accepted).toBe(false);
  });

  it("does not let an exemption hide a regression in a file that was not exempt", () => {
    const decision = judgeRatchet(
      input({
        baseline: snapshot({
          "spec.test.ts": measures({ tests: 2, assertions: 5 }),
          "other.test.ts": measures({ tests: 3, assertions: 7 }),
        }),
        candidate: snapshot({
          "spec.test.ts": measures({ tests: 1, assertions: 1 }),
          "other.test.ts": measures({ tests: 0, assertions: 0 }),
        }),
        exemptFiles: new Set(["spec.test.ts"]),
      }),
    );

    expect(decision.accepted).toBe(false);
    expect(decision.violations.map((violation) => violation.kind)).toContain(
      "tests-declared-decreased",
    );
  });

  it("stops comparing the suite-wide collected count when an exemption was granted", () => {
    const decision = judgeRatchet(
      input({
        baseline: snapshot({ "spec.test.ts": measures() }, { testsCollected: 10 }),
        candidate: snapshot({ "spec.test.ts": measures() }, { testsCollected: 8 }),
        exemptFiles: new Set(["spec.test.ts"]),
      }),
    );

    expect(decision.accepted).toBe(true);
    expect(decision.abstentions[0]).toEqual({
      measure: "testsCollected",
      reason:
        "an escape-hatch exemption was granted this attempt, and a suite-wide collected count " +
        "cannot be attributed to the exempt file, so it is not compared",
    });
  });
});

describe("the ratchet's own record", () => {
  it("carries both sides of every measure it compared", () => {
    const judged = input({
      baseline: snapshot({ "a.test.ts": measures({ tests: 4, assertions: 9, skips: 0 }) }),
      candidate: snapshot({ "a.test.ts": measures({ tests: 0, assertions: 0, skips: 1 }) }),
    });

    const payload = ratchetPayload("retry", 2, judged, judgeRatchet(judged), []);

    expect(payload.scope).toBe("retry");
    expect(payload.attempt).toBe(2);
    expect(payload.accepted).toBe(false);
    expect(payload.measures.before).toMatchObject({
      testsDeclared: 4,
      assertions: 9,
      skipMarkers: 0,
    });
    expect(payload.measures.after).toMatchObject({
      testsDeclared: 0,
      assertions: 0,
      skipMarkers: 1,
    });
    expect(payload.gates.before).toEqual({ tests: "passed", lint: "passed" });
  });
});
