import { describe, expect, it } from "vitest";
import { nextUnrun, swarmOutcome } from "./run.mjs";

describe("the next unrun tasks", () => {
  const lists = [
    { suite: "a", tasks: ["t1", "t2", "t3"] },
    { suite: "b", tasks: ["u1"] },
  ];

  it("takes each arm's first unrun tasks in list order, every arm on a task together", () => {
    const stored = [
      { arm: "x", suite: "a", task: "t1" },
      { arm: "y", suite: "a", task: "t1" },
      { arm: "y", suite: "a", task: "t2" },
    ];
    expect(nextUnrun(lists, stored, ["x", "y"], 2)).toEqual([
      { suite: "a", task: "t2", arms: ["x"] },
      { suite: "a", task: "t3", arms: ["x", "y"] },
      { suite: "b", task: "u1", arms: ["y"] },
    ]);
  });

  it("plans nothing once every task has a row", () => {
    const stored = ["t1", "t2", "t3"].map((task) => ({ arm: "x", suite: "a", task }));
    expect(nextUnrun(lists.slice(0, 1), stored, ["x"], 10)).toEqual([]);
  });
});

describe("a swarm trial's outcome", () => {
  it("reads the stop reason and verdict from the outcome block", () => {
    const output =
      "$ git diff\nstop         token-budget\nverdict      not verified\nsteps        35\n";
    expect(swarmOutcome(output)).toEqual({ stop: "token-budget", verdict: "not verified" });
  });

  it("records null for a block that never printed", () => {
    expect(swarmOutcome("swarm-exit 137\n")).toEqual({ stop: null, verdict: null });
  });
});
