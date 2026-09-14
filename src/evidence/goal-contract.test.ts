import { describe, expect, it } from "vitest";
import { freezeGoalContract } from "./goal-contract.ts";

const contract = {
  version: 1,
  goal: "pagination across components",
  requirements: [{ id: "api", description: "page through all records", checks: ["pagination"] }],
  checks: [
    {
      id: "pagination",
      command: "node goal.mjs",
      author: "user",
      exposure: "withheld",
      artifacts: [{ path: "goal.mjs", content: "assertions" }],
    },
  ],
  immutablePaths: ["test/reference.js"],
};
describe("ordinary pinned goal checks", () => {
  it("pins normalized artifacts and keeps candidate authorship distinct from a user instrument", () => {
    const supplied = freezeGoalContract(contract);
    const candidate = freezeGoalContract({
      ...contract,
      checks: [{ ...contract.checks[0], author: "model" }],
    });
    expect(supplied.digest).not.toBe(candidate.digest);
    expect(supplied.contract.checks[0]?.author).toBe("user");
    expect(
      freezeGoalContract({ ...contract, immutablePaths: ["./test/reference.js"] }).digest,
    ).toBe(supplied.digest);
  });
  it("refuses duplicate requirements and checks that cannot resolve", () => {
    expect(() =>
      freezeGoalContract({
        ...contract,
        requirements: [...contract.requirements, ...contract.requirements],
      }),
    ).toThrow("duplicate requirement");
    expect(() => freezeGoalContract({ ...contract, checks: [] })).toThrow("undefined checks");
  });
  it("refuses an artifact escape and duplicate aliases", () => {
    expect(() =>
      freezeGoalContract({
        ...contract,
        checks: [{ ...contract.checks[0], artifacts: [{ path: "../outside", content: "escape" }] }],
      }),
    ).toThrow("unsupported workspace-relative path");
    expect(() =>
      freezeGoalContract({
        ...contract,
        checks: [
          {
            ...contract.checks[0],
            artifacts: [
              { path: "goal.mjs", content: "one" },
              { path: "a/../goal.mjs", content: "two" },
            ],
          },
        ],
      }),
    ).toThrow("duplicate artifact");
  });
  it("retains a requirement without an executable check for an honest unjudged outcome", () => {
    expect(
      freezeGoalContract({
        ...contract,
        requirements: [{ id: "ux", description: "human usability review", checks: [] }],
        checks: [],
      }).contract.requirements,
    ).toHaveLength(1);
  });
});
