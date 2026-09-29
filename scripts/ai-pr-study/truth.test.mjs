import { describe, expect, it } from "vitest";
import {
  hasTaskTruth,
  plainCiDecision,
  rowTruth,
  studySets,
  suiteOf,
  tallyDecisions,
  verifierDecision,
} from "./truth.mjs";

const scored = (status, cls = "behavioural-executed") => ({
  truth: { class: cls, status, reason: "r" },
});
const row = (index, fields) => ({ index, repository: "o/r", number: index, ...fields });

describe("rowTruth", () => {
  it("reads the recorded class of a two-reviewer row", () => {
    expect(rowTruth(row(1, { adjudication: scored("requirement-met") }))).toMatchObject({
      class: "behavioural-executed",
      status: "requirement-met",
      legacy: false,
    });
    expect(rowTruth(row(2, {}))).toMatchObject({ class: "unscored", adjudicated: false });
  });

  it("classifies a legacy row by what its check executes, not by a regex over its text", () => {
    const grep = row(7, {
      adjudication: {
        status: "requirement-met",
        check: { path: "c.sh", command: "bash c.sh", contents: 'F="src/a.tsx "\ngrep -q x "$F"\n' },
      },
    });
    expect(rowTruth(grep)).toMatchObject({
      class: "text-inspected",
      status: "requirement-met",
      legacy: true,
    });
    const inline = row(20, {
      adjudication: {
        status: "requirement-met",
        check: {
          path: "t.py",
          command: 'python -c "from safety.x import A\nassert A()"',
          contents: "",
        },
      },
    });
    expect(rowTruth(inline)).toMatchObject({ class: "behavioural-executed", legacy: true });
    expect(hasTaskTruth(inline)).toBe(true);
    expect(hasTaskTruth(grep)).toBe(false);
  });
});

describe("the independent suite and the decisions", () => {
  it("A0 reads the independent arm, never the verifier's report", () => {
    const legacy = row(1, {
      outcome: "executed",
      verdict: { checks: { tests: "passed" }, originalSuiteGreen: true },
    });
    expect(suiteOf(legacy).source).toBe("none");
    expect(plainCiDecision(legacy)).toBe("unmeasured");
    const green = row(2, { originalSuite: { head: { status: "passed", collected: 4 } } });
    expect(plainCiDecision(green)).toBe("accept");
    expect(plainCiDecision(row(3, { originalSuite: { head: { status: "failed" } } }))).toBe(
      "refuse",
    );
    expect(plainCiDecision(row(4, { originalSuite: { head: { status: "setup-failed" } } }))).toBe(
      "unmeasured",
    );
  });

  it("A1 reads the verifier's report", () => {
    expect(verifierDecision(row(1, { outcome: "executed", verdict: { regression: "pass" } }))).toBe(
      "accept",
    );
    expect(verifierDecision(row(1, { outcome: "executed", verdict: { regression: "fail" } }))).toBe(
      "refuse",
    );
    expect(verifierDecision(row(1, { outcome: "blocked" }))).toBe("unmeasured");
  });
});

describe("studySets", () => {
  it("control: a suite-green row with invalid, refused verifier evidence stays in every suite-green denominator", () => {
    const corrupted = row(1, {
      outcome: "executed",
      verdict: { refusal: "evidence", regression: null },
      evidence: { valid: false, detail: "verify.mjs exited 1" },
      originalSuite: { head: { status: "passed", collected: 9 } },
      adjudication: scored("requirement-violated"),
    });
    const blocked = row(2, {
      outcome: "blocked",
      originalSuite: { head: { status: "passed", collected: 3 } },
      adjudication: scored("requirement-met"),
    });
    const red = row(3, {
      outcome: "executed",
      verdict: { regression: "pass" },
      evidence: { valid: true, detail: "ok" },
      originalSuite: { head: { status: "failed", collected: 2 } },
      adjudication: scored("requirement-met", "text-inspected"),
    });
    const sets = studySets([corrupted, blocked, red]);
    expect(sets.suiteGreen).toEqual([corrupted, blocked]);
    expect(sets.evidenceInvalid).toEqual([corrupted]);
    expect(sets.greenWithTruth).toEqual([corrupted, blocked]);
    expect(sets.falseGreen).toEqual([corrupted]);
    expect(sets.behavioural).toEqual([corrupted, blocked]);
    expect(sets.textInspected).toEqual([red]);
    expect(sets.suiteByStatus.failed).toEqual([red]);
  });

  it("every decision tally uses the same rows with task truth", () => {
    const rows = [
      row(1, {
        adjudication: scored("requirement-met"),
        originalSuite: { head: { status: "passed" } },
      }),
      row(2, {
        adjudication: scored("requirement-met", "text-inspected"),
        originalSuite: { head: { status: "passed" } },
      }),
      row(3, { adjudication: scored(null, "unscored") }),
    ];
    expect(tallyDecisions(rows, plainCiDecision)).toMatchObject({ n: 1, agree: 1 });
    expect(studySets(rows).behavioural).toHaveLength(tallyDecisions(rows, verifierDecision).n);
  });
});
