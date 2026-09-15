import { expect, it } from "vitest";
import { freezeGoalContract } from "../evidence/goal-contract.ts";
import { type GoalCandidate, selectGoalCandidate } from "./goal-selection.ts";

const contract = freezeGoalContract({
  version: 1,
  goal: "both obligations",
  selection: "cost",
  requirements: [
    { id: "read", description: "read", checks: ["read"] },
    { id: "write", description: "write", checks: ["write"] },
  ],
  checks: ["read", "write"].map((id) => ({
    id,
    command: "node --test",
    author: "user",
    exposure: "withheld",
    artifacts: [],
  })),
  immutablePaths: [],
}).contract;
const complete: GoalCandidate = {
  workerId: "complete",
  baseCommit: "base",
  attemptIndex: 1,
  regressionPassed: true,
  obligations: [
    { id: "read", accepted: true },
    { id: "write", accepted: true },
  ],
  tokenCount: 100,
  changedFiles: 2,
  changedLines: 30,
  verification: "captured",
};
it("excludes cheap omissions and regression failures before comparing costs", () => {
  const selection = selectGoalCandidate("goal", contract, [
    {
      ...complete,
      workerId: "cheap-omission",
      attemptIndex: 0,
      obligations: [{ id: "read", accepted: true }],
      tokenCount: 1,
      changedFiles: 1,
      changedLines: 1,
    },
    { ...complete, workerId: "broken", regressionPassed: false, tokenCount: 1 },
    complete,
  ]);
  expect(selection.order).toEqual(["complete"]);
  expect(selection.candidates[0]?.reason).toContain("write");
});
it("ranks measured token cost then change size, with stable attempt order for ties", () => {
  const alternatives = [
    complete,
    { ...complete, workerId: "second", attemptIndex: 2 },
    { ...complete, workerId: "cheaper", attemptIndex: 3, tokenCount: 50, changedLines: 100 },
  ];
  expect(selectGoalCandidate("goal", contract, alternatives).order).toEqual([
    "cheaper",
    "complete",
    "second",
  ]);
  expect(
    selectGoalCandidate("goal", { ...contract, selection: "change-size" }, alternatives).order,
  ).toEqual(["complete", "second", "cheaper"]);
});
it("records unavailable usage rather than treating it as zero and refuses incomparable bases", () => {
  const unknown = { ...complete, workerId: "unknown", attemptIndex: 0, tokenCount: null };
  expect(selectGoalCandidate("goal", contract, [complete, unknown]).order).toEqual([
    "complete",
    "unknown",
  ]);
  expect(selectGoalCandidate("goal", contract, [unknown]).abstentions).toHaveLength(1);
  expect(() =>
    selectGoalCandidate("goal", contract, [complete, { ...unknown, baseCommit: "another" }]),
  ).toThrow("common base");
});

it("keeps a requirement without an executable check unaccepted even when an input claims success", () => {
  const unjudged = {
    ...contract,
    requirements: [{ id: "read", description: "human judgment", checks: [] }],
  };
  expect(selectGoalCandidate("goal", unjudged, [complete]).winner).toBeNull();
});
