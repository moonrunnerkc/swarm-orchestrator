import { describe, expect, it } from "vitest";
import {
  changedFilesOf,
  describeRunOutcome,
  outcomeStatus,
  type RunOutcomeInput,
  requirementOutcomes,
} from "./cli-run-outcome.ts";
import { freezeGoalContract } from "./evidence/goal-contract.ts";
import type { RunVerdict } from "./evidence/verdict.ts";
import type { GateCycle } from "./gates/gate-runner.ts";

type GateRun = GateCycle["runs"][number];

const verdict: RunVerdict = {
  version: 1,
  integrity: "unverified",
  signer: "unverified",
  executionTrust: "restricted",
  policy: "pass",
  mechanical: "pass",
  behavioral: "pass",
  semantic: "unmeasured",
  task: "rejected",
  humanApproval: "not-required",
  reasons: { assessment: "required checks unmet: task-acceptance" },
  acceptable: false,
};

const run = (gateId: string, status: GateRun["status"]): GateRun =>
  ({
    gateId,
    status,
    severity: "blocking",
    capability: gateId === "tests" || gateId === "task-acceptance" ? "dynamic" : "static",
    detail: `${gateId} ${status}`,
    record: "sha256:0",
  }) as unknown as GateRun;

const cycle = (runs: GateRun[]): GateCycle =>
  ({
    attempt: 0,
    runs,
    statuses: {},
    blockingFailures: runs.filter((one) => one.status === "failed"),
    advisoryFailures: [],
    measures: {},
    coverageReports: [],
    coverageUnmeasured: ["node version below the floor for isolated coverage"],
    testReports: [],
  }) as unknown as GateCycle;

const base: RunOutcomeInput = {
  task: "slugify collapses whitespace to one dash and strips punctuation\nsecond line",
  verdict,
  lifecycle: "completed",
  workspace: "/work/slug",
  branch: "main",
  baseCommit: "0123456789abcdef0123456789abcdef01234567",
  changedFiles: ["slug.mjs", "cli.mjs"],
  diffTruncated: false,
  gates: cycle([
    run("tests", "passed"),
    run("task-acceptance", "failed"),
    run("format", "not-applicable"),
  ]),
  requirements: [
    {
      id: "collapse",
      description: "runs of whitespace become one dash",
      status: "accepted",
      authoredBy: "user",
      detail: null,
    },
    {
      id: "strip",
      description: "punctuation is removed",
      status: "rejected",
      authoredBy: "model",
      detail: 'stdout was "a!b"\nexpected "ab"',
    },
  ],
  finalVerification: { refusal: null, regression: "pass", unmeasured: false, advice: "" },
  usage: {
    durationMs: 674_000,
    steps: 23,
    tokensUsed: 122_734,
    callsWithUnknownUsage: 0,
    costUsd: null,
    setup: { tokensUsed: 9_100, durationMs: 41_000 },
  },
  interventions: {
    repairAttempts: 1,
    stallNotices: 1,
    stallStops: 0,
    escalations: 0,
    promptsAnsweredByPerson: 0,
    promptsPreApproved: 2,
    promptsDeclined: 0,
  },
  runId: "20261011T120000-abcdef",
  resumable: false,
};

describe("the run outcome block", () => {
  it("leads with the verdict, names each requirement's status and author, and the next action", () => {
    const text = describeRunOutcome(base).join("\n");
    expect(text).toContain("outcome: not accepted");
    expect(text).toContain(
      "requested: slugify collapses whitespace to one dash and strips punctuation",
    );
    expect(text).not.toContain("second line");
    expect(text).toContain(
      "requirements: 2 sealed, 1 met, 1 unmet, 0 unjudged (model-authored criteria",
    );
    expect(text).toContain("met      collapse: runs of whitespace become one dash");
    expect(text).toContain(
      'UNMET    strip: punctuation is removed [model-authored] (stdout was "a!b")',
    );
    expect(text).toContain("tree: /work/slug on main, measured against 0123456789ab");
    expect(text).toContain("changed: 2 file(s)");
    expect(text).toContain("checks on that tree: 1 passed, 1 failed, 1 could not run (format)");
    expect(text).toContain("coverage unmeasured: node version below the floor");
    expect(text).toContain(
      "final verification of the exact tree in a fresh checkout: regression pass",
    );
    expect(text).toContain(
      "used: 11m 14s, 23 steps, 122,734 tokens, cost not priced; of which planning and criteria 41s, 9,100 tokens",
    );
    expect(text).toContain(
      "interventions: none by a person; automatic: 1 repair attempt(s), 1 repeated-call notice(s), 2 prompt(s) answered by the approval mode",
    );
    expect(text).toContain("blocked by: required checks unmet: task-acceptance");
    expect(text).toContain("next: review the change for strip");
  });

  it("says when nothing was sealed, so a green suite is not read as the task being done", () => {
    const text = describeRunOutcome({
      ...base,
      verdict: { ...verdict, task: "unjudged", acceptable: true, reasons: {} },
      requirements: null,
      finalVerification: null,
      gates: cycle([run("tests", "passed")]),
    }).join("\n");
    // Not "accepted": with nothing sealed, the gates passing is all that was established.
    expect(text).toContain(
      "outcome: gates passed; the task itself was not judged (no requirement was sealed)",
    );
    expect(text).not.toContain("outcome: accepted");
    expect(text).toContain(
      "requirements: none were sealed, so nothing here says the task was done",
    );
    expect(text).not.toContain("blocked by");
  });

  it("points at resume when the run can be taken up, and at the refusal when it was refused", () => {
    const resumable = describeRunOutcome({
      ...base,
      lifecycle: "max-tokens",
      resumable: true,
    }).join("\n");
    expect(resumable).toContain("the loop stopped as max-tokens");
    expect(resumable).toContain(
      "next: swarm resume 20261011T120000-abcdef continues under the original budget",
    );

    const refused = describeRunOutcome({
      ...base,
      requirements: [],
      finalVerification: {
        refusal: "dependency setup failed (exit 1): no lockfile",
        regression: "unmeasured",
        unmeasured: true,
        advice: "",
      },
      verdict: { ...verdict, task: "unjudged", reasons: { task: "final verification refused" } },
    }).join("\n");
    expect(refused).toContain("final verification refused: dependency setup failed");
    expect(refused).toContain("next: fix what the refusal names");
  });

  it("counts a person's answers apart from the approval mode's, and a lower-bound token total", () => {
    const text = describeRunOutcome({
      ...base,
      usage: { ...base.usage, callsWithUnknownUsage: 2, setup: null },
      interventions: {
        ...base.interventions,
        promptsAnsweredByPerson: 3,
        promptsDeclined: 1,
        promptsPreApproved: 0,
        stallNotices: 0,
        repairAttempts: 0,
      },
    }).join("\n");
    expect(text).toContain("(a lower bound: 2 call(s) reported no usage)");
    expect(text).not.toContain("of which planning");
    expect(text).toContain(
      "interventions: 3 prompt(s) answered by you, 1 declined; automatic: none",
    );
  });
});

describe("reading the record", () => {
  it("lists the files a patch touches once each", () => {
    const patch = [
      "diff --git a/slug.mjs b/slug.mjs",
      "--- a/slug.mjs",
      "+++ b/slug.mjs",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "diff --git a/cli.mjs b/cli.mjs",
      "diff --git a/slug.mjs b/slug.mjs",
    ].join("\n");
    expect(changedFilesOf(patch)).toEqual(["slug.mjs", "cli.mjs"]);
    expect(changedFilesOf("")).toEqual([]);
  });

  it("joins the sealed words with the verification's statuses and the refusing check's detail", () => {
    const contract = freezeGoalContract({
      version: 1,
      goal: "g",
      requirements: [
        { id: "collapse", description: "one dash", checks: ["c"] },
        { id: "strip", description: "no punctuation", checks: ["s"] },
        { id: "docs", description: "documented", checks: [] },
      ],
      checks: [
        { id: "c", command: "node cli.mjs", author: "user", exposure: "shared", artifacts: [] },
        { id: "s", command: "node cli.mjs", author: "model", exposure: "shared", artifacts: [] },
      ],
      immutablePaths: [],
    }).contract;
    expect(
      requirementOutcomes(contract, {
        goalAcceptance: {
          obligations: [
            { id: "collapse", status: "accepted" },
            { id: "strip", status: "rejected" },
            { id: "docs", status: "unjudged" },
          ],
          checkResults: [
            { id: "c", status: "accepted", detail: "" },
            { id: "s", status: "rejected", detail: "expected ab" },
          ],
        },
      }),
    ).toEqual([
      {
        id: "collapse",
        description: "one dash",
        status: "accepted",
        authoredBy: "user",
        detail: null,
        source: "supplied",
      },
      {
        id: "strip",
        description: "no punctuation",
        status: "rejected",
        authoredBy: "model",
        detail: "expected ab",
        source: "supplied",
      },
      {
        id: "docs",
        description: "documented",
        status: "unjudged",
        authoredBy: "user",
        detail: null,
        source: "supplied",
      },
    ]);
    // No verification at all: every requirement is unjudged rather than guessed.
    expect(requirementOutcomes(contract, undefined).map((one) => one.status)).toEqual([
      "unjudged",
      "unjudged",
      "unjudged",
    ]);
  });
});

describe("the run's one status", () => {
  const plannedContract = freezeGoalContract({
    version: 1,
    goal: "classify",
    requirements: [
      { id: "visible", description: "the supplied check passes", checks: ["visible"] },
      {
        id: "ten-is-small",
        description: "10 is small",
        checks: [],
        planned: { quote: "change the classifier so 10 is small", diagnostics: ["boundary"] },
      },
      {
        id: "above-ten-big",
        description: "values above 10 stay big",
        checks: [],
        planned: { quote: "values above 10 remain big", diagnostics: [] },
      },
    ],
    checks: [
      { id: "visible", command: "node v.mjs", author: "user", exposure: "shared", artifacts: [] },
      { id: "boundary", command: "planned", author: "model", exposure: "shared", artifacts: [] },
    ],
    immutablePaths: [],
  }).contract;
  const finished = (boundary: "accepted" | "rejected", visible: "accepted" | "rejected") =>
    requirementOutcomes(plannedContract, {
      goalAcceptance: {
        obligations: [
          { id: "visible", status: visible },
          { id: "ten-is-small", status: "unjudged" },
          { id: "above-ten-big", status: "unjudged" },
        ],
        checkResults: [
          { id: "visible", status: visible, detail: visible === "accepted" ? "" : "exit 1" },
          {
            id: "boundary",
            status: boundary,
            detail: boundary === "accepted" ? "" : "line 3 should be small but was big",
          },
        ],
      },
    });
  const unverifiedTask = {
    ...verdict,
    task: "unjudged" as const,
    acceptable: false,
    reasons: { assessment: "blocking gate(s) failed: task-acceptance" },
  };

  it("calls a correct candidate that a wrong generated expectation disagrees with unresolved, not rejected", () => {
    const input = {
      ...base,
      verdict: unverifiedTask,
      requirements: finished("rejected", "accepted"),
      gates: cycle([run("tests", "passed"), run("task-acceptance", "failed")]),
    };
    expect(outcomeStatus(input)).toBe("unresolved");
    const text = describeRunOutcome(input).join("\n");
    expect(text).toContain("outcome: unresolved (a generated check disagrees with the change");
    expect(text).toContain("DISPUTED ten-is-small: 10 is small");
    expect(text).toContain(
      "generated check boundary: disagrees (line 3 should be small but was big)",
    );
    expect(text).not.toContain("UNMET");
    expect(text).not.toContain("blocked by");
    expect(text).toContain("next: read the disputed requirement(s) ten-is-small against the task");
  });

  it("keeps a requirement in the task's words with no check visible, and the run partially checked", () => {
    const input = {
      ...base,
      verdict: { ...unverifiedTask, reasons: { task: "pinned goal checks: unjudged" } },
      requirements: finished("accepted", "accepted"),
      gates: cycle([run("tests", "passed"), run("task-acceptance", "passed")]),
    };
    expect(outcomeStatus(input)).toBe("partially-checked");
    const text = describeRunOutcome(input).join("\n");
    expect(text).toContain("outcome: partially checked");
    expect(text).toContain(
      "requirements: 3 sealed, 1 met, 0 unmet, 2 unjudged; 2 read from the task",
    );
    expect(text).toContain(
      'no check above-ten-big: values above 10 stay big [planned from the task: "values above 10 remain big"]',
    );
    expect(text).toContain("no generated check held its base control, so nothing exercised it");
    expect(text).toContain(
      "generated check boundary: agrees with the change; its expected results are the planner's",
    );
    expect(text).toContain(
      "next: review the change against the requirement(s) nothing decided (ten-is-small, above-ten-big)",
    );
  });

  it("lets a refusal by a supplied check win over any generated disagreement", () => {
    expect(
      outcomeStatus({
        ...base,
        verdict: { ...unverifiedTask, task: "rejected" },
        requirements: finished("rejected", "rejected"),
      }),
    ).toBe("not-accepted");
  });

  it("names a supplied-only acceptance as the sealed requirements, not the whole task", () => {
    const supplied = requirementOutcomes(
      freezeGoalContract({
        version: 1,
        goal: "g",
        requirements: [{ id: "visible", description: "the supplied check", checks: ["v"] }],
        checks: [{ id: "v", command: "x", author: "user", exposure: "shared", artifacts: [] }],
        immutablePaths: [],
      }).contract,
      { goalAcceptance: { obligations: [{ id: "visible", status: "accepted" }] } },
    );
    const input = {
      ...base,
      verdict: { ...verdict, task: "accepted" as const, acceptable: true, reasons: {} },
      requirements: supplied,
      gates: cycle([run("tests", "passed"), run("task-acceptance", "passed")]),
    };
    expect(outcomeStatus(input)).toBe("accepted");
    expect(describeRunOutcome(input).join("\n")).toContain(
      "scope: these are the requirements that were sealed; nothing checked the rest of the task's wording",
    );
  });

  it("never reads acceptable for a status the bundle verdict refuses, or the reverse", () => {
    const cases: RunOutcomeInput[] = [
      base,
      { ...base, verdict: { ...verdict, acceptable: true, task: "unjudged" }, requirements: null },
      { ...base, verdict: unverifiedTask, requirements: finished("rejected", "accepted") },
      { ...base, verdict: unverifiedTask, requirements: finished("accepted", "accepted") },
      { ...base, verdict: { ...verdict, acceptable: false, task: "unjudged" }, requirements: null },
      {
        ...base,
        lifecycle: "interrupted",
        verdict: unverifiedTask,
        requirements: finished("accepted", "accepted"),
      },
    ];
    for (const one of cases) {
      const status = outcomeStatus(one);
      const exitsZero = status === "accepted" || status === "unjudged";
      expect({ status, exitsZero }).toEqual({ status, exitsZero: one.verdict.acceptable });
      if (status === "accepted") expect(one.verdict.task).not.toBe("rejected");
    }
  });
});
