import { describe, expect, it } from "vitest";
import { budgetMatched, campaignArms, describeArmReport, scoreArms } from "./arms.ts";

describe("the arms a campaign compares", () => {
  it("defines the arms the design calls for, each named by what it varies", () => {
    const ids = campaignArms.map((arm) => arm.id);

    expect(ids).toContain("single-minimal");
    expect(ids).toContain("single-evidence");
    expect(ids).toContain("single-gates");
    expect(ids).toContain("graph-fixed");
    expect(ids).toContain("redundancy-3");
  });

  it("gives every arm the same aggregate budget, or the comparison measures the budget", () => {
    const matched = budgetMatched(campaignArms, { tokens: 300_000, wallMs: 1_800_000 });

    for (const arm of matched) {
      expect(arm.budget.tokens).toBe(300_000);
      expect(arm.budget.wallMs).toBe(1_800_000);
    }
  });

  it("divides a redundant arm's budget across its attempts rather than multiplying it", () => {
    // Three attempts at the full budget is three times the compute, and an arm that wins on
    // three times the compute has not been shown to be better.
    const matched = budgetMatched(campaignArms, { tokens: 300_000, wallMs: 1_800_000 });
    const redundant = matched.find((arm) => arm.id === "redundancy-3");

    expect(redundant?.perAttempt.tokens).toBe(100_000);
  });

  it("scores arms from their runs and reports intervals rather than points", () => {
    const scored = scoreArms([
      {
        armId: "single-minimal",
        runs: Array.from({ length: 40 }, (_, index) => ({
          launched: true,
          completed: true,
          accepted: index % 2 === 0,
          costUsd: 0.1,
          latencyMs: 1_000,
        })),
      },
      {
        armId: "single-gates",
        runs: Array.from({ length: 40 }, (_, index) => ({
          launched: true,
          completed: true,
          accepted: index % 4 !== 0,
          costUsd: 0.2,
          latencyMs: 2_000,
        })),
      },
    ]);

    expect(scored).toHaveLength(2);
    expect(scored[0]?.accepted.lower).toBeLessThan(scored[0]?.accepted.point ?? 1);
    expect(scored[1]?.costPerAccepted).toBeGreaterThan(0);
  });

  it("reports an arm with no accepted runs without dividing by zero", () => {
    const scored = scoreArms([
      {
        armId: "single-minimal",
        runs: [{ launched: true, completed: true, accepted: false, costUsd: 1, latencyMs: 1 }],
      },
    ]);

    expect(scored[0]?.costPerAccepted).toBeNull();
    expect(describeArmReport(scored)).toMatch(/no accepted/i);
  });

  it("renders a report that says what was launched, not only what worked", () => {
    const rendered = describeArmReport(
      scoreArms([
        {
          armId: "single-minimal",
          runs: [
            { launched: true, completed: false, accepted: false, costUsd: 0, latencyMs: 0 },
            { launched: true, completed: true, accepted: true, costUsd: 1, latencyMs: 10 },
          ],
        },
      ]),
    );

    expect(rendered).toContain("2 launched");
    expect(rendered).toMatch(/1 crashed/);
  });
});
