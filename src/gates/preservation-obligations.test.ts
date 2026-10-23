import { describe, expect, it } from "vitest";
import {
  describePreservation,
  initialObligations,
  keepStatements,
  settleObligations,
} from "./preservation-obligations.ts";

const task =
  "Rename lib/a.js to lib/b.js. Each moved module exports exactly what it exported before; the public API behaves as today. The project's tests must keep passing. Add a test for the new name.";

describe("what a run must preserve", () => {
  it("takes the task's own sentences about keeping behaviour, in its order", () => {
    expect(keepStatements(task)).toEqual([
      "Each moved module exports exactly what it exported before;",
      "the public API behaves as today.",
      "The project's tests must keep passing.",
    ]);
  });

  it("ties each obligation to its source and authority, and always names the base suite", () => {
    const obligations = initialObligations({
      task,
      contract: {
        version: 1,
        goal: "g",
        requirements: [
          {
            id: "visible-check",
            description: "the visible check passes",
            checks: ["visible-check"],
          },
          {
            id: "planned-one",
            description: "the planner's reading",
            checks: [],
            planned: { diagnostics: [] },
          },
        ],
        checks: [],
        immutablePaths: [],
        selection: "stable",
      },
    });
    expect(obligations.map((one) => [one.id, one.source, one.authority])).toEqual([
      ["task-keep-1", "task", "authoritative"],
      ["task-keep-2", "task", "authoritative"],
      ["task-keep-3", "task", "authoritative"],
      ["contract-visible-check", "contract", "authoritative"],
      ["base-suite", "base", "observed"],
    ]);
  });
});

describe("what ran says about each obligation", () => {
  const obligations = initialObligations({ task });

  it("never reads an unmeasured set as preserved", () => {
    const statuses = settleObligations({
      obligations,
      regression: "unmeasured",
      requirements: [],
      probes: [],
    });
    expect(statuses.every((one) => one.status === "unmeasured")).toBe(true);
    expect(describePreservation(statuses)).toBe(
      "preservation: nothing measured (4 obligation(s), every one unmeasured)",
    );
  });

  it("settles the base suite from the regression reading and a task sentence only from a probe quoting it", () => {
    const statuses = settleObligations({
      obligations,
      regression: "pass",
      requirements: [],
      probes: [
        {
          probe: "api",
          statement: "the public API",
          quote: "the public API behaves as today",
          readings: ["kept", "preservation-regression", "unstable"],
        },
        { probe: "flaky", statement: "timing", quote: null, readings: ["unstable"] },
      ],
    });
    const by = Object.fromEntries(statuses.map((one) => [one.id, one.status]));
    expect(by).toEqual({
      "task-keep-1": "unmeasured",
      "task-keep-2": "regressed",
      "task-keep-3": "unmeasured",
      "base-suite": "kept",
      "review-api": "regressed",
      "review-flaky": "unmeasured",
    });
    expect(describePreservation(statuses)).toContain("1 kept, 2 regressed, 3 unmeasured, of 6");
  });

  it("binds a probe to a task sentence only by quoting at least half of it, and keeps only what every case measured", () => {
    const statuses = settleObligations({
      obligations,
      regression: "pass",
      requirements: [],
      probes: [
        { probe: "fragment", statement: "x", quote: "e", readings: ["kept"] },
        {
          probe: "partial",
          statement: "the public API",
          quote: "the public API behaves as today",
          readings: ["kept", "unstable"],
        },
      ],
    });
    const by = Object.fromEntries(statuses.map((one) => [one.id, one.status]));
    expect(by["task-keep-1"]).toBe("unmeasured");
    expect(by["task-keep-2"]).toBe("unmeasured");
    expect(by["review-fragment"]).toBe("kept");
    expect(by["review-partial"]).toBe("unmeasured");
  });
});
