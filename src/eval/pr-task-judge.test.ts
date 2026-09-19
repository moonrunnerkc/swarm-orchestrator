import { describe, expect, it } from "vitest";
import {
  type HalfJudge,
  type HalfVerdict,
  type JudgedTask,
  judgeAgainstBothHalves,
  runnerKind,
  scoreHeldBack,
  settleHeldBack,
  taskSlug,
  whyNothingWasJudged,
} from "./pr-task-judge.ts";

const task = {
  repository: "winstonjs/winston",
  pull: 2256,
  baseCommit: "a".repeat(40),
  testFile: "test/container.test.js",
  runner: "npx mocha test/container.test.js",
  sealedCases: ["adds a logger"],
  heldBackCases: ["closes a logger"],
};

/** A judge that answers by which cases it was asked about, and remembers how it was asked. */
function judgeAnswering(answers: Record<string, HalfVerdict["task"]>) {
  const asked: { titles: readonly string[]; oracleOnly: boolean }[] = [];
  const judge: HalfJudge = async (titles, options) => {
    asked.push({ titles, oracleOnly: options?.oracleOnly === true });
    return { regression: "pass", task: answers[titles.join("+")] ?? "rejected" };
  };
  return { judge, asked };
}

describe("a held-back refusal, told apart from the half being run alone", () => {
  it("reads a half that fails alone and passes in company as order dependence", async () => {
    const { judge, asked } = judgeAnswering({
      "closes a logger": "rejected",
      "adds a logger+closes a logger": "accepted",
    });

    const settled = await settleHeldBack(judge, task, "accepted", { oracleOnly: true });

    expect(settled).toMatchObject({ heldBackVerdict: "accepted", orderDependent: true });
    expect(asked.map((one) => one.oracleOnly)).toEqual([true, true]);
  });

  it("keeps a refusal that also fails in company", async () => {
    const { judge } = judgeAnswering({});
    expect(await settleHeldBack(judge, task, "accepted")).toMatchObject({
      heldBackVerdict: "rejected",
      orderDependent: false,
    });
  });

  it("asks only where the answer can change, which is where the sealed half accepted", async () => {
    const { judge, asked } = judgeAnswering({});
    await settleHeldBack(judge, task, "rejected");
    expect(asked).toHaveLength(1);
  });

  it("classifies the corner from both halves through the one shared rule", async () => {
    const { judge } = judgeAnswering({
      "adds a logger": "accepted",
      "closes a logger": "accepted",
    });
    const judged = await judgeAgainstBothHalves(judge, task);
    // Accepted by both and not certified, since this judge reports no `verified`.
    expect(judged.corner).toBe("false-red");
  });
});

describe("the small readings a pass is built from", () => {
  it("names why nothing was judged, in the verifier's own words", () => {
    expect(whyNothingWasJudged({ regression: "pass", task: "accepted" })).toBeNull();
    expect(
      whyNothingWasJudged({ regression: "unmeasured", task: "unjudged", applied: false }),
    ).toMatch(/did not apply/);
    expect(
      whyNothingWasJudged({ regression: "unmeasured", task: "unjudged", judgeFailure: "killed" }),
    ).toBe("killed");
  });

  it("reads the runner from the command and names a task's files one way", () => {
    expect(runnerKind("npx jest --ci a.test.js")).toBe("jest");
    expect(runnerKind("node --test a.test.js")).toBe("node");
    expect(taskSlug(task)).toBe("winstonjs__winston-2256");
  });
});

describe("the one held-back scoring rule", () => {
  const task: JudgedTask = {
    repository: "a/b",
    pull: 7,
    baseCommit: "b".repeat(40),
    testFile: "test/x.test.js",
    runner: "node --test test/x.test.js",
    sealedCases: ["visible case"],
    heldBackCases: ["held-back case"],
  };
  const judging = (
    answers: Record<string, HalfJudge extends (...args: never) => Promise<infer V> ? V : never>,
  ) => {
    const asked: { titles: readonly string[]; oracleOnly: boolean }[] = [];
    const judge: HalfJudge = async (titles, options) => {
      asked.push({ titles, oracleOnly: options?.oracleOnly === true });
      const answer = answers[titles.join("|")];
      if (answer === undefined) throw new Error(`no answer for ${titles.join("|")}`);
      return answer;
    };
    return { judge, asked };
  };

  it("reads the held-back half alone, oracle only", async () => {
    const { judge, asked } = judging({
      "held-back case": { task: "accepted", regression: "unmeasured" },
    });
    expect(await scoreHeldBack(judge, task, "accepted")).toEqual({
      hidden: "pass",
      basis: "the held-back half's own verdict on this patch",
      heldBackVerdict: "accepted",
      orderDependent: false,
      heldBackBond: null,
    });
    expect(asked).toEqual([{ titles: ["held-back case"], oracleOnly: true }]);
  });

  it("reads a refusal that disappears beside the visible half as order dependence", async () => {
    const { judge } = judging({
      "held-back case": { task: "rejected", regression: "unmeasured" },
      "visible case|held-back case": { task: "accepted", regression: "unmeasured" },
    });
    expect(await scoreHeldBack(judge, task, "accepted")).toMatchObject({
      hidden: "pass",
      orderDependent: true,
    });
  });

  it("names why a verdict judged nothing, and never converts it", async () => {
    const { judge } = judging({
      "held-back case": {
        task: "unjudged",
        regression: "unmeasured",
        judgeFailure: "swarm ci was killed at its deadline: x",
      },
    });
    expect(await scoreHeldBack(judge, task, "accepted")).toMatchObject({
      hidden: "unjudgeable",
      basis: "swarm ci was killed at its deadline: x",
    });
  });
});
