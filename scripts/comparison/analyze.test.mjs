import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  claimedCompletion,
  renderMarkdown,
  summarize,
  withSupplementalScores,
} from "./analyze.mjs";

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

describe("a completion claim", () => {
  it("is read from the completion account where the record carries one, else from the one-word field", () => {
    expect(claimedCompletion(undefined)).toBe(false);
    expect(claimedCompletion({ claimedSuccess: true })).toBe(true);
    expect(claimedCompletion({ claimedSuccess: false })).toBe(false);
    // The account outranks the word: a turn that ended wanting tool results was once a claim.
    expect(
      claimedCompletion({
        claimedSuccess: true,
        completion: { ended: "exited", claim: "none", basis: "tool-calls" },
      }),
    ).toBe(false);
    expect(
      claimedCompletion({
        claimedSuccess: false,
        completion: { ended: "exited", claim: "claimed", basis: "answered" },
      }),
    ).toBe(true);
    expect(
      claimedCompletion({
        claimedSuccess: false,
        completion: { ended: "killed", claim: "unknown", basis: "no finished turn" },
      }),
    ).toBe(false);
    const summary = summarize([
      record("opencode", "a", {
        hidden: { verdict: "fail" },
        invocations: [
          {
            claimedSuccess: true,
            completion: { ended: "exited", claim: "none", basis: "tool-calls" },
          },
        ],
      }),
    ]);
    expect(summary.arms.opencode.claimedSuccessButHiddenFailed).toBe(0);
  });
});

describe("a halted launch scored after the fact", () => {
  const stages = [];
  afterEach(() => {
    for (const stage of stages.splice(0)) rmSync(stage, { recursive: true, force: true });
  });

  it("reads with its supplemental score, named as such, and leaves the record alone", () => {
    const stage = mkdtempSync(join(tmpdir(), "analyze-stage-"));
    stages.push(stage);
    mkdirSync(join(stage, "scored"));
    writeFileSync(
      join(stage, "scored/a.swarm.json"),
      JSON.stringify({
        patchDigest: "sha256:abc",
        visible: { passed: true },
        hidden: {
          verdict: "pass",
          basis: "hidden tests passed",
          policy: { addedAssertions: 18 },
          displaced: ["test/a.js"],
        },
      }),
    );
    const halted = record("swarm", "a", {
      infrastructureFailure:
        "the swarm arm exited 4 (unavailable): the product could not run the task",
      hidden: { verdict: "unjudgeable", basis: "not scored" },
      resolvedVisible: false,
    });
    const plain = record("opencode", "a");
    const rows = withSupplementalScores([halted, plain], stage);
    expect(rows[1]).toBe(plain);
    expect(rows[0]).toMatchObject({
      infrastructureFailure: null,
      resolvedVisible: true,
      hidden: { verdict: "pass" },
      supplemental: {
        source: "scored/a.swarm.json",
        patchDigest: "sha256:abc",
        displaced: ["test/a.js"],
      },
    });
    expect(halted.infrastructureFailure).not.toBeNull();
    const summary = summarize(rows);
    expect(summary.arms.swarm).toMatchObject({ started: 1, infrastructureFailures: 0, correct: 1 });
    expect(renderMarkdown(summary)).toContain("| a | pass (supplemental scoring) | pass |");
    // A halted launch with no score stays an infrastructure attempt.
    expect(
      withSupplementalScores([record("swarm", "b", { infrastructureFailure: "x" })], stage)[0]
        .infrastructureFailure,
    ).toBe("x");
  });
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
