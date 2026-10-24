import { describe, expect, it } from "vitest";
import {
  describePreservation,
  extractionLimit,
  initialObligations,
  keepStatements,
  type ProbeObligation,
  reviewAuthorities,
  settleObligations,
  unclassifiedSentences,
} from "./preservation-obligations.ts";

const task =
  "Rename lib/a.js to lib/b.js. Each moved module exports exactly what it exported before; the public API behaves as today. The project's tests must keep passing. Add a test for the new name.";

const contract = {
  version: 1 as const,
  goal: "g",
  requirements: [
    {
      id: "filter-query",
      description: "filterQuery(input, predicate) keeps only the keys the predicate accepts",
      checks: ["visible-check"],
    },
    {
      id: "old-api",
      description: "withQuery(input, query) returns what it returns today",
      checks: ["old-api-check"],
      intent: "preserve" as const,
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
  selection: "stable" as const,
};

const kept = (index: number, input: unknown, answer: string) => ({
  index,
  input,
  base: answer,
  candidate: answer,
  reading: "kept",
});

describe("what a run must preserve, and what it must produce", () => {
  it("takes the task's own sentences about keeping behaviour, in its order", () => {
    expect(keepStatements(task)).toEqual([
      "Each moved module exports exactly what it exported before;",
      "the public API behaves as today.",
      "The project's tests must keep passing.",
    ]);
  });

  it("reads clear preservation wording in modal form, and keeps every other sentence as task text", () => {
    const exportsTask =
      "Add a filterQuery helper. All public exports must remain available. Options should continue to default to an empty object.";
    expect(keepStatements(exportsTask)).toEqual([
      "All public exports must remain available.",
      "Options should continue to default to an empty object.",
    ]);
    expect(unclassifiedSentences(exportsTask)).toEqual(["Add a filterQuery helper."]);
    expect(extractionLimit).toContain("retained as unclassified task text");
  });

  it("keeps every obligation past twelve, none dropped for a count", () => {
    const many = Array.from(
      { length: 14 },
      (_, index) => `Option ${index + 1} must keep working.`,
    ).join(" ");
    const obligations = initialObligations({ task: many });
    expect(obligations.filter((one) => one.source === "task")).toHaveLength(14);
    expect(obligations.at(-2)?.id).toBe("task-keep-14");
  });

  it("ties each obligation to its source, category and authority, and always names the base suite", () => {
    const obligations = initialObligations({ task, contract });
    expect(obligations.map((one) => [one.id, one.source, one.category, one.authority])).toEqual([
      ["task-keep-1", "task", "explicit-preserve", "authoritative"],
      ["task-keep-2", "task", "explicit-preserve", "authoritative"],
      ["task-keep-3", "task", "explicit-preserve", "authoritative"],
      ["contract-filter-query", "contract", "requested", "authoritative"],
      ["contract-old-api", "contract", "explicit-preserve", "authoritative"],
      ["base-suite", "base", "observed", "observed"],
    ]);
    // Only what the task or its contract stated as kept can make a difference a regression.
    expect(reviewAuthorities(obligations).map((one) => one.id)).toEqual([
      "task-keep-1",
      "task-keep-2",
      "task-keep-3",
      "contract-old-api",
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

  it("reports a passing new feature as requested behaviour met, never as preserved", () => {
    const statuses = settleObligations({
      obligations: initialObligations({ task: "Add filterQuery.", contract }),
      regression: "pass",
      requirements: [
        { id: "filter-query", status: "accepted" },
        { id: "old-api", status: "accepted" },
      ],
      probes: [],
    });
    const by = Object.fromEntries(statuses.map((one) => [one.id, [one.category, one.status]]));
    expect(by["contract-filter-query"]).toEqual(["requested", "met"]);
    expect(by["contract-old-api"]).toEqual(["explicit-preserve", "held"]);
    expect(describePreservation(statuses)).toBe(
      "preservation: 2 held, 0 exercised by examples only, 0 regressed, 0 unmeasured, of 2 obligation(s) from the task, the supplied contract, the base suite and review probes; requested behaviour (new, not preserved): 1 met, 0 unmet, 0 unjudged",
    );
  });

  it("reads a task sentence a probe names as exercised by its examples, never as held, with each case recorded", () => {
    const api: ProbeObligation = {
      probe: "api",
      statement: "the public API",
      quote: "the public API behaves as today",
      obligation: "task-keep-2",
      cases: [kept(1, { path: "/a" }, '"/a"'), kept(2, { path: "/b" }, '"/b"')],
    };
    const statuses = settleObligations({
      obligations,
      regression: "pass",
      inherited: ["lint"],
      requirements: [],
      probes: [api],
    });
    const byId = new Map(statuses.map((one) => [one.id, one]));
    expect(byId.get("task-keep-2")?.status).toBe("exercised");
    expect(byId.get("task-keep-2")?.by).toContain("the statement as a whole is not established");
    expect(byId.get("task-keep-2")?.evidence).toEqual([
      {
        check: "review probe api, case 1",
        input: { path: "/a" },
        base: '"/a"',
        candidate: '"/a"',
        reading: "kept",
      },
      {
        check: "review probe api, case 2",
        input: { path: "/b" },
        base: '"/b"',
        candidate: '"/b"',
        reading: "kept",
      },
    ]);
    expect(byId.get("base-suite")).toMatchObject({ status: "held" });
    expect(byId.get("base-suite")?.by).toContain("failures the base already had remain in lint");
    expect(byId.get("review-api")).toMatchObject({ category: "proposed", status: "exercised" });
  });

  it("settles a sentence only from a probe naming it, and regresses it on one established case", () => {
    const statuses = settleObligations({
      obligations,
      regression: "pass",
      requirements: [],
      probes: [
        {
          probe: "fragment",
          statement: "x",
          quote: "e",
          obligation: null,
          cases: [kept(1, "a", '"a"')],
        },
        {
          probe: "api",
          statement: "the public API",
          quote: "the public API behaves as today",
          obligation: "task-keep-2",
          cases: [
            kept(1, "a", '"a"'),
            {
              index: 2,
              input: "b",
              base: '"b"',
              candidate: '"B"',
              reading: "preservation-regression",
            },
          ],
        },
        {
          probe: "flaky",
          statement: "timing",
          quote: null,
          obligation: "task-keep-3",
          cases: [{ index: 1, input: 1, base: null, candidate: null, reading: "unstable" }],
        },
      ],
    });
    const by = Object.fromEntries(statuses.map((one) => [one.id, one.status]));
    expect(by).toEqual({
      "task-keep-1": "unmeasured",
      "task-keep-2": "regressed",
      "task-keep-3": "unmeasured",
      "base-suite": "held",
      "review-fragment": "exercised",
      "review-api": "regressed",
      "review-flaky": "unmeasured",
    });
  });
});

it("does not read a sentence whose own code asks for a change as behaviour to keep", () => {
  const task =
    'Fix strip(input, prefix). When the prefix is not present, strip returns input unchanged (strip("/admin-x", "/admin") is "/admin-x"). Today strip("/admin-x", "/admin") returns "-x" unchanged as if it matched. What must not change: strip("/admin/y", "/admin") stays "/y".';
  // The first two have keep wording ("unchanged") and only requested or today's examples.
  expect(keepStatements(task)).toEqual([
    'What must not change: strip("/admin/y", "/admin") stays "/y".',
  ]);
  expect(unclassifiedSentences(task)).toEqual([
    "Fix strip(input, prefix).",
    'When the prefix is not present, strip returns input unchanged (strip("/admin-x", "/admin") is "/admin-x").',
    'Today strip("/admin-x", "/admin") returns "-x" unchanged as if it matched.',
  ]);
});
