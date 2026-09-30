import { describe, expect, it } from "vitest";
import {
  ciDecision,
  swarmCiDecision,
  swarmResultLine,
  swarmTaskDecision,
  swarmTaskTokens,
  veraDecision,
} from "./decisions.mjs";

describe("registered decision readings", () => {
  it("accepts only a verified swarm-verify run and refuses what it charged to the patch", () => {
    expect(swarmCiDecision({ verified: true, regression: "pass", task: "accepted" })).toBe(
      "accept",
    );
    expect(swarmCiDecision({ verified: false, regression: "fail", task: "accepted" })).toBe(
      "refuse",
    );
    expect(swarmCiDecision({ verified: false, regression: "pass", task: "rejected" })).toBe(
      "refuse",
    );
    expect(swarmCiDecision({ verified: false, regression: "pass", task: "vacuous" })).toBe(
      "refuse",
    );
    expect(
      swarmCiDecision({
        verified: false,
        regression: "pass",
        task: "accepted",
        refusal: "challenges-unmet: gap",
      }),
    ).toBe("refuse");
    expect(swarmCiDecision({ verified: false, regression: "unmeasured", task: "unjudged" })).toBe(
      "inconclusive",
    );
    expect(
      swarmCiDecision({
        verified: false,
        regression: "pass",
        task: "accepted",
        challenges: { policy: "required", satisfied: false },
      }),
    ).toBe("refuse");
    expect(
      swarmCiDecision({
        verified: false,
        regression: "unmeasured",
        task: "unjudged",
        refusal: "the patch changes test/a.spec.ts, which the run declared immutable.",
      }),
    ).toBe("refuse");
    expect(
      swarmCiDecision({
        verified: false,
        regression: "unmeasured",
        refusal: "a fresh checkout could not be made",
      }),
    ).toBe("inconclusive");
    expect(swarmCiDecision(null)).toBe("inconclusive");
  });

  it("gives plain CI no third answer and never accepts an empty run", () => {
    expect(ciDecision([0, 0])).toBe("accept");
    expect(ciDecision([0, 1])).toBe("refuse");
    expect(ciDecision([])).toBe("refuse");
  });

  it("reads VERA's verify by its own printed verdict and exit status", () => {
    expect(veraDecision(0, "GOAL PASS\n")).toBe("accept");
    expect(veraDecision(1, "FAIL exit_code\n")).toBe("refuse");
    expect(veraDecision(0, "no records\n")).toBe("inconclusive");
  });

  it("reads the swarm task command's result line and its spent tokens", () => {
    const stdout = [
      JSON.stringify({ schema: "swarm.event.v1", event: { type: "stopped", tokensUsed: 1200 } }),
      JSON.stringify({ schema: "swarm.event.v1", event: { type: "stopped", tokensUsed: 300 } }),
      JSON.stringify({ schema: "swarm.result.v1", verdict: { acceptable: true }, exitCode: 0 }),
    ].join("\n");
    const result = swarmResultLine(stdout);
    expect(swarmTaskDecision(0, result)).toBe("accept");
    expect(swarmTaskDecision(1, result)).toBe("refuse");
    expect(swarmTaskDecision(3, result)).toBe("inconclusive");
    expect(swarmTaskDecision(0, null)).toBe("inconclusive");
    expect(swarmTaskTokens(stdout)).toBe(1500);
    expect(swarmTaskTokens("plain text\n")).toBeNull();
  });
});
