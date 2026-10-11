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
      record("swarm", "c", {
        infrastructureFailure: "endpoint down",
        hidden: { verdict: "unjudgeable" },
        invocations: [],
        totals: { agentWallMs: 0, tokens: null, tokensUnknownInvocations: 0 },
      }),
      record("swarm", "c"),
      record("opencode", "c", {
        infrastructureFailure: "preparation failed",
        hidden: { verdict: "unjudgeable" },
        invocations: [],
        totals: { agentWallMs: 0, tokens: null, tokensUnknownInvocations: 0 },
      }),
    ]);
    // The rerun of c replaces its failed attempt; the failed attempt stays in the files.
    expect(summary.arms.swarm).toMatchObject({
      started: 3,
      infrastructureFailures: 0,
      correct: 2,
      correctWithoutCorrection: 2,
      correctionsTotal: 2,
      visibleUnresolved: 1,
      claimedSuccessButHiddenFailed: 1,
      tokensAllKnown: 3000,
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
      "| correct completion (hidden oracle passed) / started | 2 / 3 | 1 / 3 |",
    );
    expect(text).toContain("| b | fail (+2 corr.), visible unresolved | fail |");
    expect(text).toContain("| c | pass | infrastructure |");
  });
});
