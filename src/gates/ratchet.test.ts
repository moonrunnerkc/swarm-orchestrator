import { describe, expect, it } from "vitest";
import type { GateStatus } from "../core/loop-events.ts";
import { emptyMeasureSnapshot, type MeasureSnapshot } from "./measure-snapshot.ts";
import type { TestFileMeasures } from "./measures.ts";
import { judgeRatchet, type RatchetInput, ratchetPayload } from "./ratchet.ts";

/**
 * Named tests rather than a bare count, since the comparison is per test. Everything the
 * caller asks for lands on the first test unless it names its own, which keeps a count-shaped
 * case reading the way it did while the arithmetic underneath is set-based.
 */
function measures(partial: Partial<TestFileMeasures> = {}): TestFileMeasures {
  const tests = partial.tests ?? 1;
  const assertions = partial.assertions ?? 1;
  const skips = partial.skips ?? 0;
  const perTest =
    partial.perTest ??
    Object.fromEntries(
      Array.from({ length: tests }, (_, index) => [
        `t${index + 1}`,
        index === 0 ? { assertions, skips } : { assertions: 0, skips: 0 },
      ]),
    );

  return {
    tests: Object.keys(perTest).length,
    assertions,
    skips,
    perTest,
    outsideTests: { assertions: 0, skips: 0 },
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
    newSpecifications: new Set(),
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

  it("abstains by name on a gate the harness could not run, rather than reading the refusal as a regression", () => {
    // A repair loop spent the last of the wall budget; the candidate's gates were refused
    // before they could start. Three real runs read that as "passed before and now reports
    // failed" and undid the attempt as a regression. Nothing moved: nothing was measured.
    const refusal =
      "execution refused before spawn: no time remained in the wall budget, so this gate measured nothing";
    const decision = judgeRatchet(
      input({
        baselineGates: { tests: "passed", lint: "passed" },
        candidateGates: { tests: "not-applicable", lint: "not-applicable" },
        unmeasuredGates: new Map([
          ["tests", refusal],
          ["lint", refusal],
        ]),
      }),
    );

    expect(decision.accepted).toBe(true);
    expect(decision.violations).toEqual([]);
    const gates = decision.abstentions.filter((abstention) =>
      abstention.measure.startsWith("gate:"),
    );
    expect(gates.map((abstention) => abstention.measure)).toEqual(["gate:tests", "gate:lint"]);
    expect(gates[0]?.reason).toContain("could not be run in this attempt");
    expect(gates[0]?.reason).toContain("no time remained");
    expect(decision.detail).toContain("not compared: gate:tests, gate:lint");
  });

  it("still rejects a gate the candidate itself made unavailable, which is a change to the instrument", () => {
    // The same "not-applicable" status with no refusal behind it: the attempt deleted the test
    // script from the manifest. That is the regression the gate comparison exists to catch.
    const decision = judgeRatchet(
      input({
        baselineGates: { tests: "passed" },
        candidateGates: { tests: "not-applicable" },
      }),
    );

    expect(decision.accepted).toBe(false);
    expect(decision.violations[0]?.kind).toBe("gate-regressed");
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

describe("the ratchet escape hatch, per test rather than per file", () => {
  const rewritten = (names: readonly [string, number][]) =>
    measures({
      tests: names.length,
      assertions: names.reduce((sum, [, count]) => sum + count, 0),
      perTest: Object.fromEntries(
        names.map(([name, assertions]) => [name, { assertions, skips: 0 }]),
      ),
    });

  it("clears a whole-file re-specification where every test is new", () => {
    // Part C's case: refusing every file-level exemption rejects this, which is legitimate
    // work. Two deletions, two proven new specifications, one for one.
    const judged = input({
      baseline: snapshot({
        "spec.test.ts": rewritten([
          ["adds", 2],
          ["subtracts", 3],
        ]),
      }),
      candidate: snapshot({
        "spec.test.ts": rewritten([
          ["adds negatives", 1],
          ["subtracts negatives", 1],
        ]),
      }),
      newSpecifications: new Set([
        "spec.test.ts::adds negatives",
        "spec.test.ts::subtracts negatives",
      ]),
    });

    expect(judgeRatchet(judged).accepted).toBe(true);
    // Without the controls behind it the same edit is a four-assertion drop, and is rejected.
    expect(judgeRatchet({ ...judged, newSpecifications: new Set() }).accepted).toBe(false);
  });

  it("catches the test a file deleted beside the one new specification it added", () => {
    // The hole this closes: one new spec used to exempt the file, so every deletion beside
    // it went unexamined. It pays for one deletion, and the other is still compared.
    const decision = judgeRatchet(
      input({
        baseline: snapshot({
          "spec.test.ts": rewritten([
            ["adds", 1],
            ["subtracts", 1],
          ]),
        }),
        candidate: snapshot({ "spec.test.ts": rewritten([["adds negatives", 1]]) }),
        newSpecifications: new Set(["spec.test.ts::adds negatives"]),
      }),
    );

    expect(decision.accepted).toBe(false);
    expect(decision.violations.map((violation) => violation.kind)).toContain(
      "tests-declared-decreased",
    );
  });

  it("clears nothing for a test that already existed at the base", () => {
    // A cleared name has to be new here. The run's own failing test would otherwise buy a
    // deletion just by failing on the base source, which every failing test does.
    const decision = judgeRatchet(
      input({
        baseline: snapshot({
          "spec.test.ts": rewritten([
            ["adds", 2],
            ["subtracts", 2],
          ]),
        }),
        candidate: snapshot({ "spec.test.ts": rewritten([["adds", 2]]) }),
        newSpecifications: new Set(["spec.test.ts::adds"]),
      }),
    );

    expect(decision.accepted).toBe(false);
    expect(decision.violations.map((violation) => violation.kind)).toContain(
      "tests-declared-decreased",
    );
  });

  it("does not let one file's cleared test pay for another file's deletion", () => {
    const decision = judgeRatchet(
      input({
        baseline: snapshot({
          "spec.test.ts": rewritten([["adds", 1]]),
          "other.test.ts": rewritten([["parses", 1]]),
        }),
        candidate: snapshot({
          "spec.test.ts": rewritten([["adds negatives", 1]]),
          "other.test.ts": rewritten([]),
        }),
        newSpecifications: new Set(["spec.test.ts::adds negatives"]),
      }),
    );

    expect(decision.accepted).toBe(false);
    expect(decision.violations.map((violation) => violation.kind)).toContain(
      "tests-declared-decreased",
    );
  });

  it("stops comparing the suite-wide collected count when a new specification was cleared", () => {
    const decision = judgeRatchet(
      input({
        baseline: snapshot({ "spec.test.ts": measures() }, { testsCollected: 10 }),
        candidate: snapshot({ "spec.test.ts": measures() }, { testsCollected: 8 }),
        newSpecifications: new Set(["spec.test.ts::t1"]),
      }),
    );

    expect(decision.accepted).toBe(true);
    expect(decision.abstentions[0]).toEqual({
      measure: "testsCollected",
      reason:
        "a new specification was cleared this attempt, and a suite-wide collected count " +
        "cannot be attributed to one test, so it is not compared",
    });
  });
});

describe("the parts of one gate", () => {
  const failing: Record<string, GateStatus> = { tests: "passed", acceptance: "failed" };
  const judged = (after: Record<string, GateStatus>) =>
    input({
      baselineGates: failing,
      candidateGates: failing,
      baselineParts: { acceptance: { ten: "failed", twelve: "passed" } },
      candidateParts: { acceptance: after },
    });

  it("rejects a retry that breaks a passing part while the gate was failing before and after", () => {
    const decision = judgeRatchet(judged({ ten: "failed", twelve: "failed" }));

    expect(decision.accepted).toBe(false);
    expect(decision.violations).toEqual([
      expect.objectContaining({
        kind: "gate-part-regressed",
        detail: "twelve in the acceptance gate passed before this attempt and now reports failed",
      }),
    ]);
  });

  it("accepts a retry that fixes a failing part and keeps the passing one", () => {
    expect(judgeRatchet(judged({ ten: "passed", twelve: "passed" })).accepted).toBe(true);
  });

  it("abstains by name on a part the attempt did not report, and on every part of a gate it could not run", () => {
    const missing = judgeRatchet(judged({ ten: "failed" }));
    expect(missing.accepted).toBe(true);
    expect(missing.abstentions.map((one) => one.measure)).toContain("gate:acceptance:twelve");

    const notRun = judgeRatchet({
      ...judged({ ten: "failed", twelve: "failed" }),
      unmeasuredGates: new Map([["acceptance", "the wall budget was spent"]]),
    });
    expect(notRun.accepted).toBe(true);
    expect(notRun.abstentions).toContainEqual({
      measure: "gate:acceptance:twelve",
      reason: "the wall budget was spent",
    });
  });

  it("records both sides of every part it compared", () => {
    const sides = judged({ ten: "failed", twelve: "failed" });
    const payload = ratchetPayload("retry", 1, sides, judgeRatchet(sides), []);
    expect(payload.parts).toEqual({
      before: { acceptance: { ten: "failed", twelve: "passed" } },
      after: { acceptance: { ten: "failed", twelve: "failed" } },
    });
    expect(ratchetPayload("retry", 1, input({}), judgeRatchet(input({})), [])).not.toHaveProperty(
      "parts",
    );
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

describe("coverage nothing could measure", () => {
  it("names the runtime floor as the reason the coverage arm abstained", () => {
    const reason = "node version below the floor for isolated coverage: found v22.22.3";
    const decision = judgeRatchet(
      input({
        baseline: snapshot({}, { changedLineCoverageUnmeasured: reason }),
        candidate: snapshot({}, { changedLineCoverageUnmeasured: reason }),
      }),
    );

    const abstention = decision.abstentions.find((one) => one.measure === "changedLineCoverage");
    expect(decision.accepted).toBe(true);
    expect(abstention?.reason).toContain(reason);
  });

  it("still abstains by name where no reason was recorded", () => {
    const decision = judgeRatchet(input({}));

    const abstention = decision.abstentions.find((one) => one.measure === "changedLineCoverage");
    expect(abstention?.reason).toBe("nothing measured this on either side of the attempt");
  });
});
