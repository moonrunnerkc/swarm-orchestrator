import { describe, expect, it } from "vitest";
import { renderMarkdown, summarize } from "./analyze.mjs";

const record = (arm, task, over) => ({
  arm,
  task,
  infrastructureFailure: null,
  hidden: { verdict: "pass" },
  corrections: 0,
  resolvedVisible: true,
  invocations: [{ claimedSuccess: true }],
  totals: { agentWallMs: 60_000, tokens: 1000, tokensUnknownInvocations: 0 },
  preparation: { wallMs: 5_000 },
  ...over,
});

describe("the comparison tables", () => {
  it("counts each dimension against the number started and never combines them", () => {
    const summary = summarize([
      record("swarm", "a"),
      record("swarm", "b", { hidden: { verdict: "fail" }, corrections: 2, resolvedVisible: false }),
      record("opencode", "a", { corrections: 1 }),
      record("opencode", "b", {
        hidden: { verdict: "fail" },
        invocations: [{ claimedSuccess: true }],
      }),
      record("opencode", "c", {
        infrastructureFailure: "preparation failed",
        hidden: { verdict: "unjudgeable" },
        invocations: [],
        totals: { agentWallMs: 0, tokens: null, tokensUnknownInvocations: 0 },
      }),
    ]);
    expect(summary.arms.swarm).toMatchObject({
      started: 2,
      correct: 1,
      correctWithoutCorrection: 1,
      correctionsTotal: 2,
      visibleUnresolved: 1,
      claimedSuccessButHiddenFailed: 1,
      tokensAllKnown: 2000,
    });
    expect(summary.arms.opencode).toMatchObject({
      started: 3,
      infrastructureFailures: 1,
      correct: 1,
      correctWithoutCorrection: 0,
      claimedSuccessButHiddenFailed: 1,
      tokensUnknownRuns: 1,
    });
    const text = renderMarkdown(summary);
    expect(text).toContain(
      "| correct completion (hidden oracle passed) / started | 1 / 2 | 1 / 3 |",
    );
    expect(text).toContain("| b | fail (+2 corr.), visible unresolved | fail |");
    expect(text).toContain("| c | not run | infrastructure |");
  });
});
