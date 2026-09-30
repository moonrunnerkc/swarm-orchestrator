import { describe, expect, it } from "vitest";
import { outcomeOf, pairedEffect, superiority, tabulate } from "./analyze.mjs";

const record = (decision, truth, wallMs = 1000, tokens = 100) => ({
  decision,
  truth,
  wallMs,
  tokens: { total: tokens },
});

describe("outcome classes", () => {
  it("keeps forged evidence around correct source apart from false rejections", () => {
    expect(outcomeOf(record("refuse", { condition: "correct-source-forged-evidence" }))).toBe(
      "forged-refused",
    );
    expect(outcomeOf(record("refuse", { condition: "correct" }))).toBe("false-rejection");
    expect(outcomeOf(record("accept", { condition: "incorrect-source-forged-evidence" }))).toBe(
      "incorrect-approval",
    );
    expect(outcomeOf(record("accept", { hiddenOracle: "fail" }))).toBe("incorrect-approval");
    expect(outcomeOf(record("accept", { hiddenOracle: "pass" }))).toBe("correct-approval");
    expect(outcomeOf(record("inconclusive", { hiddenOracle: "pass" }))).toBe("inconclusive");
    expect(outcomeOf(record("accept", { hiddenOracle: "unjudgeable" }))).toBe("unjudgeable");
  });
});

describe("paired effects", () => {
  it("is reproducible and brackets a constant difference exactly", () => {
    const rates = { a: { left: 1, right: 0.5 }, b: { left: 0.5, right: 0 } };
    const first = pairedEffect(rates, { resamples: 500 });
    expect(first).toEqual(pairedEffect(rates, { resamples: 500 }));
    expect(first.difference).toBeCloseTo(0.5);
    expect(first.low).toBeCloseTo(0.5);
    expect(first.high).toBeCloseTo(0.5);
    expect(pairedEffect({}).difference).toBeNull();
  });
});

describe("the superiority rule", () => {
  const margins = {
    comparison: "B",
    incorrectApprovalReduction: 0.1,
    correctApprovalLoss: 0.1,
    wallTimeRatio: 2,
    wallExtraMs: 15 * 60_000,
    tokenRatio: 2,
    decisionMs: 10 * 60_000,
    criticalBypassesInTreatmentOnly: 0,
  };
  const launches = [];
  const records = new Map();
  const add = (goal, arm, decision, hidden, wallMs = 1000) => {
    const launch = { id: `${goal}.${arm}.${launches.length}`, goal, arm };
    launches.push(launch);
    records.set(launch.id, record(decision, { hiddenOracle: hidden }, wallMs));
  };

  it("fails an arm that refuses everything, however few incorrect results it approves", () => {
    for (const goal of ["g1", "g2", "g3"]) {
      add(goal, "comparator", "accept", "fail");
      add(goal, "comparator", "accept", "pass");
      add(goal, "refuse-all", "refuse", "fail");
      add(goal, "refuse-all", "refuse", "pass");
    }
    const cells = tabulate(launches, (launch) => records.get(launch.id));
    const verdict = superiority(cells, "refuse-all", "comparator", margins);
    expect(verdict.clauses.fewerIncorrectApprovals).toBe(true);
    expect(verdict.clauses.acceptableCorrectApprovalLoss).toBe(false);
    expect(verdict.clauses.approvesCorrectWorkWhereComparatorDoes).toBe(false);
    expect(verdict.superior).toBe(false);
  });

  it("passes an arm that refuses the incorrect work and keeps the correct, within overhead", () => {
    launches.length = 0;
    records.clear();
    for (const goal of ["g1", "g2", "g3", "g4"]) {
      add(goal, "comparator", "accept", "fail");
      add(goal, "comparator", "accept", "pass");
      add(goal, "treatment", "refuse", "fail", 1500);
      add(goal, "treatment", "accept", "pass", 1500);
    }
    const cells = tabulate(launches, (launch) => records.get(launch.id));
    const verdict = superiority(cells, "treatment", "comparator", margins);
    expect(verdict.superior).toBe(true);
    expect(
      superiority(cells, "treatment", "comparator", { ...margins, wallTimeRatio: 1.2 }).superior,
    ).toBe(false);
  });

  it("fails the cost clause where tokens are unmeasured, and reads Comparison A by decision time", () => {
    const cells = [
      { goal: "g1", arm: "c", outcomes: { "correct-approval": 1 }, wallMs: [1000], tokens: [null] },
      { goal: "g1", arm: "t", outcomes: { "correct-approval": 1 }, wallMs: [1500], tokens: [null] },
    ];
    expect(superiority(cells, "t", "c", margins).clauses.practicalCost).toBe(false);
    const inA = superiority(cells, "t", "c", { ...margins, comparison: "A" });
    expect(inA.clauses.practicalCost).toBe(true);
    expect(
      superiority(cells, "t", "c", { ...margins, comparison: "A", decisionMs: 1000 }).clauses
        .practicalCost,
    ).toBe(false);
  });
});
