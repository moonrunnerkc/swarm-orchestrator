import { describe, expect, it } from "vitest";
import { describeVerdict, runVerdict } from "./verdict.ts";

function cycle(
  runs: readonly { id: string; capability: string; status: string; severity?: string }[],
  changedFiles = 3,
) {
  return {
    runs: runs.map((run) => ({
      gateId: run.id,
      capability: run.capability,
      status: run.status,
      severity: run.severity ?? "blocking",
      kind: "command",
    })),
    blockingFailures: runs
      .filter((run) => run.status === "failed" && (run.severity ?? "blocking") === "blocking")
      .map((run) => ({ gateId: run.id })),
    measures: { changedFiles },
  } as never;
}

describe("what a run establishes, as more than one answer", () => {
  it("keeps mechanical and behavioural apart where only the static gates ran", () => {
    const verdict = runVerdict({
      cycle: cycle([
        { id: "lint", capability: "static", status: "passed" },
        { id: "tests", capability: "dynamic", status: "not-applicable" },
      ]),
      integrity: "valid",
      signer: "untrusted",
      executionTrust: "restricted",
    });

    expect(verdict.mechanical).toBe("pass");
    expect(verdict.behavioral).toBe("unmeasured");
    expect(verdict.semantic).toBe("unmeasured");
    expect(verdict.task).toBe("unjudged");
  });

  it("does not coerce unmeasured into a failure either, because they are different findings", () => {
    const verdict = runVerdict({
      cycle: cycle([{ id: "tests", capability: "dynamic", status: "not-applicable" }]),
      integrity: "valid",
      signer: "untrusted",
      executionTrust: "restricted",
    });

    expect(verdict.behavioral).toBe("unmeasured");
    expect(verdict.behavioral).not.toBe("fail");
  });

  it("reports behavioural pass only where a dynamic gate actually passed", () => {
    const verdict = runVerdict({
      cycle: cycle([
        { id: "lint", capability: "static", status: "passed" },
        { id: "tests", capability: "dynamic", status: "passed" },
      ]),
      integrity: "valid",
      signer: "trusted",
      executionTrust: "isolated",
    });

    expect(verdict.behavioral).toBe("pass");
    expect(verdict.mechanical).toBe("pass");
  });

  it("fails mechanically on a static gate failure without touching the behavioural answer", () => {
    const verdict = runVerdict({
      cycle: cycle([
        { id: "lint", capability: "static", status: "failed" },
        { id: "tests", capability: "dynamic", status: "passed" },
      ]),
      integrity: "valid",
      signer: "untrusted",
      executionTrust: "restricted",
    });

    expect(verdict.mechanical).toBe("fail");
    expect(verdict.behavioral).toBe("pass");
  });

  it("carries the policy answer from the policy gates alone", () => {
    const verdict = runVerdict({
      cycle: cycle([
        { id: "secret-scan", capability: "policy", status: "failed" },
        { id: "tests", capability: "dynamic", status: "passed" },
      ]),
      integrity: "valid",
      signer: "untrusted",
      executionTrust: "restricted",
    });

    expect(verdict.policy).toBe("fail");
    expect(verdict.behavioral).toBe("pass");
    expect(verdict.mechanical).toBe("unmeasured");
  });

  it("says a tree nothing touched was not left unmeasured, since there was nothing to run over", () => {
    const verdict = runVerdict({
      cycle: cycle([{ id: "tests", capability: "dynamic", status: "not-applicable" }], 0),
      integrity: "valid",
      signer: "untrusted",
      executionTrust: "restricted",
    });

    expect(verdict.behavioral).toBe("unmeasured");
    expect(verdict.acceptable).toBe(true);
  });

  it("is not acceptable where the change was never executed", () => {
    const verdict = runVerdict({
      cycle: cycle([
        { id: "lint", capability: "static", status: "passed" },
        { id: "tests", capability: "dynamic", status: "not-applicable" },
      ]),
      integrity: "valid",
      signer: "untrusted",
      executionTrust: "restricted",
    });

    expect(verdict.acceptable).toBe(false);
  });

  it("renders each dimension with the reason beside it, never as a bare word", () => {
    const lines = describeVerdict(
      runVerdict({
        cycle: cycle([
          { id: "lint", capability: "static", status: "passed" },
          { id: "tests", capability: "dynamic", status: "not-applicable" },
        ]),
        integrity: "valid",
        signer: "untrusted",
        executionTrust: "restricted",
      }),
    ).join("\n");

    expect(lines).toContain("behavioral");
    expect(lines).toContain("unmeasured");
    expect(lines).toMatch(/no dynamic gate|nothing executed/i);
  });
});
