import { expect, it } from "vitest";
import {
  classifyCrossoverGoals,
  compareWorkerPair,
  summarizeCrossover,
} from "./pilot-crossover.mjs";

const slot = (accepted, time, tokens) => ({
  outcome: {
    status: "completed",
    certified: accepted,
    heldBackAccepted: accepted,
    goal: { inputTokens: tokens, outputTokens: 0, unknownCalls: 0, reservedTokens: 0 },
  },
  executionWallMs: time,
});
it("does not rank a faster failed goal above an accepted goal", () => {
  expect(compareWorkerPair(slot(true, 100, 100), slot(false, 1, 1))).toBe("single-only-accepted");
  expect(compareWorkerPair(slot(false, 1, 1), slot(true, 100, 100))).toBe("parallel-only-accepted");
  expect(compareWorkerPair(slot(false, 1, 1), slot(false, 100, 100))).toBe("neither-accepted");
});
it("keeps tradeoffs, unknown usage and infrastructure errors distinct", () => {
  expect(compareWorkerPair(slot(true, 10, 10), slot(true, 20, 20))).toBe("single-dominates");
  expect(compareWorkerPair(slot(true, 20, 20), slot(true, 10, 10))).toBe("parallel-dominates");
  expect(compareWorkerPair(slot(true, 10, 20), slot(true, 20, 10))).toBe("tradeoff");
  expect(compareWorkerPair(slot(true, 10, 10), slot(true, 10, 10))).toBe("tie");
  const unknown = slot(true, 10, 10);
  unknown.outcome.goal.unknownCalls = 1;
  expect(compareWorkerPair(unknown, slot(true, 20, 20))).toBe("unknown-resources");
  const infrastructure = slot(false, 1, 1);
  infrastructure.outcome.status = "infrastructure-failure";
  expect(compareWorkerPair(slot(true, 20, 20), infrastructure)).toBe("unknown-judgment");
  expect(compareWorkerPair(undefined, slot(true, 20, 20))).toBe("unknown-judgment");
});
it("excludes declaration tests and reports overlapping goal groups without pooling arms", () => {
  const patch = [
    "src/option.ts",
    "typings/index.test-d.ts",
    "tests/option.test.ts",
    "docs/example.py",
  ]
    .map(
      (path) =>
        `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`,
    )
    .join("");
  const candidates = [{ id: "tj-commander-js-1678", referencePatch: patch }];
  expect(classifyCrossoverGoals(candidates)[0]).toMatchObject({
    productionFiles: ["src/option.ts"],
    productionChangedLines: 2,
    groups: ["tiny", "single-file", "coupled"],
  });
  expect(classifyCrossoverGoals([{ id: "constructor", referencePatch: patch }])[0].groups).toEqual([
    "tiny",
    "single-file",
  ]);
  expect(() =>
    summarizeCrossover(
      candidates,
      [
        { caseId: "goal", armId: "single", seed: 0 },
        { caseId: "goal", armId: "single", seed: 1 },
      ],
      [],
    ),
  ).toThrow("declared aggregation");
  const report = summarizeCrossover(
    candidates,
    [],
    [{ id: "single" }, { id: "adaptive" }, { id: "no-peer" }],
  );
  expect(report.pairs).toHaveLength(2);
  expect(report.groups[0].arms).toEqual([
    { armId: "adaptive", goalPairs: 1, decisions: { "unknown-judgment": 1 } },
    { armId: "no-peer", goalPairs: 1, decisions: { "unknown-judgment": 1 } },
  ]);
});
