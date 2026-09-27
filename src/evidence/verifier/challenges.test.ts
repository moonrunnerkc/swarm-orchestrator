import { describe, expect, it } from "vitest";
import {
  type AlternativeOutcome,
  type BaseControlReading,
  type ContractCheckStatus,
  readRequirementOutcome,
} from "../../gates/goal-challenges.ts";
import type { GoalContract } from "../goal-contract.ts";
import { readChallengeOutcome } from "./challenges.mjs";

/**
 * The offline reading and the producer's reading are two implementations of one rule. This holds
 * them to the same answer over every combination the rule distinguishes, so a divergence shows
 * here rather than in a bundle that verifies under one and not the other.
 */
const requirement: GoalContract["requirements"][number] = {
  id: "r",
  description: "r",
  checks: ["c"],
};
const bare: GoalContract["requirements"][number] = { id: "r", description: "r", checks: [] };

function alternative(partial: Partial<AlternativeOutcome>): AlternativeOutcome {
  return {
    id: "m",
    kind: "mutant",
    parse: "not-checked",
    tree: null,
    requirements: [{ id: "r", status: "rejected" }],
    suite: "not-run",
    witness: "not-adjudicated",
    ...partial,
  };
}

const alternatives: AlternativeOutcome[][] = [
  [],
  [alternative({})],
  [
    alternative({
      requirements: [{ id: "r", status: "accepted" }],
      witness: "repository-suite",
      suite: "failed",
    }),
  ],
  [
    alternative({
      requirements: [{ id: "r", status: "accepted" }],
      witness: "none",
      suite: "passed",
    }),
  ],
  [alternative({ requirements: [{ id: "r", status: "unjudged" }] })],
  [alternative({ parse: "syntax-error", requirements: [] })],
  [
    alternative({
      id: "f",
      kind: "fixture",
      fixture: { id: "f", requirement: "r", digest: "sha256:x" },
      parse: "not-applied",
      requirements: [],
    }),
  ],
  [
    alternative({
      id: "f",
      kind: "fixture",
      fixture: { id: "f", requirement: "other", digest: "sha256:x" },
      requirements: [{ id: "other", status: "accepted" }],
      witness: "declared-fixture",
    }),
  ],
  [
    alternative({}),
    alternative({ id: "n", requirements: [{ id: "r", status: "accepted" }], witness: "none" }),
  ],
];
const bases: BaseControlReading[] = [
  "discriminates",
  "vacuous",
  "preserved",
  "unavailable",
  "not-run",
];
const candidates: ContractCheckStatus[] = ["accepted", "rejected", "unjudged"];

describe("the offline challenge reading", () => {
  it("agrees with the producer's reading over every distinguished combination", () => {
    let cases = 0;
    for (const req of [requirement, bare])
      for (const candidate of candidates)
        for (const baseControl of bases)
          for (const set of alternatives) {
            const producer = readRequirementOutcome({
              requirement: req,
              candidate,
              baseControl,
              alternatives: set,
            });
            const offline = readChallengeOutcome({
              requirement: req,
              candidate,
              baseControl,
              alternatives: set,
            });
            expect(
              { ...offline },
              JSON.stringify({ req: req.id, candidate, baseControl, set }),
            ).toEqual({
              outcome: producer.outcome,
              caught: producer.caught,
              gaps: producer.gaps,
              unwitnessed: producer.unwitnessed,
              invalid: producer.invalid,
            });
            cases += 1;
          }
    expect(cases).toBe(2 * 3 * 5 * alternatives.length);
  });
});
