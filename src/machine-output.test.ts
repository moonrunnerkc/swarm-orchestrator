import { describe, expect, it } from "vitest";
import { exitCodes, jsonEventLine, jsonResultLine } from "./machine-output.ts";

/**
 * A stable line-delimited JSON stream, so a CI job or another agent reads a run without
 * scraping the text a person reads. Two shapes only: an event as it happens, and one result at
 * the end. Both carry a schema version, because a consumer that cannot tell which shape it is
 * reading has to guess, and guessing is what makes a machine interface break silently.
 */
describe("the machine-readable stream", () => {
  it("renders one event as one line of JSON", () => {
    const line = jsonEventLine({ type: "plan", text: "do the thing" }, { runId: "r1" });
    const parsed = JSON.parse(line);

    expect(parsed).toMatchObject({
      schema: "swarm.event.v1",
      runId: "r1",
      event: { type: "plan" },
    });
    expect(line).not.toContain("\n");
  });

  it("renders a final result carrying every verdict dimension, not a boolean", () => {
    const line = jsonResultLine({
      runId: "r1",
      verdict: {
        version: 1,
        integrity: "valid",
        signer: "untrusted",
        executionTrust: "restricted",
        policy: "pass",
        mechanical: "pass",
        behavioral: "unmeasured",
        semantic: "unmeasured",
        task: "unjudged",
        humanApproval: "not-required",
        reasons: { behavioral: "no dynamic gate ran" },
        acceptable: false,
      },
      bundleDirectory: "/session/bundle",
      exitCode: exitCodes.notAcceptable,
    });
    const parsed = JSON.parse(line);

    expect(parsed.schema).toBe("swarm.result.v1");
    expect(parsed.verdict.behavioral).toBe("unmeasured");
    expect(parsed.verdict.acceptable).toBe(false);
    expect(parsed.exitCode).toBe(exitCodes.notAcceptable);
  });

  it("gives every exit code a distinct meaning a caller can branch on", () => {
    const values = Object.values(exitCodes);

    expect(new Set(values).size).toBe(values.length);
    expect(exitCodes.acceptable).toBe(0);
  });

  it("keeps a run identifier on every line, so interleaved runs can be told apart", () => {
    const event = JSON.parse(jsonEventLine({ type: "plan", text: "x" }, { runId: "a" }));
    const result = JSON.parse(
      jsonResultLine({ runId: "a", verdict: null, bundleDirectory: null, exitCode: 0 }),
    );

    expect(event.runId).toBe("a");
    expect(result.runId).toBe("a");
  });

  it("survives a value that would break a line, because output is one line per record", () => {
    const line = jsonEventLine({ type: "plan", text: "first\nsecond" }, { runId: "r1" });

    expect(line.split("\n")).toHaveLength(1);
    expect(JSON.parse(line).event.text).toBe("first\nsecond");
  });
});

describe("what a caller can tell from the exit code alone", () => {
  it("separates a run that was measured and found wanting from one that could not start", () => {
    expect(exitCodes.notAcceptable).not.toBe(exitCodes.unavailable);
    expect(exitCodes.notAcceptable).not.toBe(exitCodes.invalidRequest);
  });

  it("separates a harness bug from work that did not pass", () => {
    expect(exitCodes.internalError).not.toBe(exitCodes.notAcceptable);
  });
});
