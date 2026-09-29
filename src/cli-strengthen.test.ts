import { describe, expect, it } from "vitest";
import { readProposal, repairBrief, strengtheningLimits } from "./cli-strengthen.ts";
import { freezeGoalContract, revisionProblem } from "./evidence/goal-contract.ts";
import { readAdmission, readRevision } from "./evidence/verifier/strengthening.mjs";
import { type AdmissionRun, admissionDecision } from "./gates/check-admission.ts";

describe("the strengthening limits", () => {
  it("default to two rounds and one admitted check per requirement, and are lowered, never raised", () => {
    expect(strengtheningLimits({})).toEqual({ rounds: 2, perRequirement: 1 });
    expect(strengtheningLimits({ rounds: 5, perRequirement: 3 })).toEqual({
      rounds: 2,
      perRequirement: 1,
    });
    expect(strengtheningLimits({ rounds: 1, perRequirement: 0 })).toEqual({
      rounds: 1,
      perRequirement: 0,
    });
  });
});

describe("reading a proposal", () => {
  const valid = {
    id: "clamp-range",
    command: "node --test acceptance/strengthened/a.test.mjs",
    artifacts: [{ path: "acceptance/strengthened/a.test.mjs", content: "x" }],
    rationale: "bounds",
  };
  it("takes the JSON object out of prose, and names what is wrong with anything else", () => {
    expect(readProposal(`Here it is:\n${JSON.stringify(valid)}\nThanks`)).toEqual(valid);
    expect(readProposal("no json here")).toBe("the answer holds no JSON object");
    expect(readProposal("{not json}")).toMatch(/^the proposal is not JSON/);
    expect(readProposal(JSON.stringify({ ...valid, id: "Bad Id" }))).toMatch(
      /^the proposal is malformed/,
    );
    expect(readProposal(JSON.stringify({ ...valid, extra: true }))).toMatch(
      /^the proposal is malformed/,
    );
  });
});

describe("the repair brief", () => {
  it("is bounded, names the check and the pinned files, and asks for implementation changes only", () => {
    const brief = repairBrief({
      requirement: { id: "clamp-bounds", description: "d".repeat(20_000) },
      check: {
        id: "clamp-range",
        command: "node --test x",
        artifacts: [{ path: "acceptance/strengthened/x" }],
      },
      counterexample: { kind: "base", paths: ["clamp.mjs"] },
    });
    expect(brief.length).toBeLessThanOrEqual(6000);
    expect(brief).toContain("clamp-range");
  });
});

describe("the admission rule, live and offline", () => {
  const statuses = ["accepted", "rejected", "unjudged"] as const;
  it("admits only a check that rejects the counterexample and accepts every reference, and the two implementations agree", () => {
    let admitted = 0;
    for (const counterexample of statuses)
      for (const first of statuses)
        for (const second of statuses)
          for (const references of [[], ["one"], ["one", "two"]] as const)
            for (const withCandidate of [true, false]) {
              const runs: AdmissionRun[] = [
                {
                  purpose: "counterexample",
                  reference: null,
                  verification: null,
                  status: counterexample,
                },
                ...references.map((reference, index) => ({
                  purpose: "reference" as const,
                  reference,
                  verification: null,
                  status: index === 0 ? first : second,
                })),
                ...(withCandidate
                  ? [
                      {
                        purpose: "candidate" as const,
                        reference: null,
                        verification: null,
                        status: "rejected" as const,
                      },
                    ]
                  : []),
              ];
              const live = admissionDecision(runs, references);
              expect(readAdmission(runs, references)).toEqual({
                ...live,
                reasons: [...live.reasons],
              });
              if (live.admitted) {
                admitted++;
                expect(counterexample).toBe("rejected");
                expect(references.length).toBeGreaterThan(0);
                expect(withCandidate).toBe(true);
              }
            }
    expect(admitted).toBeGreaterThan(0);
  });
});

describe("a contract revision, live and offline", () => {
  const parent = freezeGoalContract({
    version: 1,
    goal: "g",
    requirements: [
      { id: "a", description: "first", checks: ["a-one"] },
      { id: "b", description: "second", checks: ["b-one"] },
    ],
    checks: [
      { id: "a-one", command: "true", author: "user", exposure: "shared", artifacts: [] },
      { id: "b-one", command: "true", author: "user", exposure: "shared", artifacts: [] },
    ],
    immutablePaths: [],
  }).contract;
  const added = {
    id: "a-two",
    command: "node --test t",
    author: "model" as const,
    exposure: "shared" as const,
    artifacts: [],
  };
  const admitted = [{ requirement: "a", check: added }];
  const revised = {
    ...parent,
    requirements: [
      { ...parent.requirements[0], checks: ["a-one", "a-two"] },
      parent.requirements[1],
    ],
    checks: [...parent.checks, added],
  } as typeof parent;

  it("accepts only the parent with the admitted checks appended, in both implementations", () => {
    expect(revisionProblem(parent, revised, admitted)).toBeNull();
    expect(readRevision(parent, revised, admitted)).toBeNull();
    const weakened = {
      ...revised,
      checks: revised.checks.map((check) =>
        check.id === "a-one" ? { ...check, command: "exit 0" } : check,
      ),
    };
    const renamed = {
      ...revised,
      requirements: [
        { ...revised.requirements[0], description: "easier" },
        revised.requirements[1],
      ],
    } as typeof parent;
    const dropped = {
      ...revised,
      requirements: [{ ...revised.requirements[0], checks: ["a-two"] }, revised.requirements[1]],
    } as typeof parent;
    const unadmitted = {
      ...revised,
      requirements: [
        revised.requirements[0],
        { ...parent.requirements[1], checks: ["b-one", "a-two"] },
      ],
    } as typeof parent;
    for (const bad of [weakened, renamed, dropped, unadmitted]) {
      const live = revisionProblem(parent, bad, admitted);
      expect(live).not.toBeNull();
      expect(readRevision(parent, bad, admitted)).toBe(live);
    }
  });
});
