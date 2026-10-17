import { describe, expect, it } from "vitest";
import {
  acceptedAssessmentReason,
  blockingReason,
  describeVerdict,
  runVerdict,
} from "./verdict.ts";

function cycle(
  runs: readonly {
    id: string;
    capability: string;
    status: string;
    severity?: string;
    measures?: Record<string, number>;
  }[],
  changedFiles = 3,
) {
  return {
    runs: runs.map((run) => ({
      gateId: run.id,
      capability: run.capability,
      status: run.status,
      severity: run.severity ?? "blocking",
      kind: "command",
      detail: `${run.id} ${run.status}`,
      record: `sha256:${run.id.padEnd(64, "0").slice(0, 64)}`,
      measures: run.measures ?? {},
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

describe("what a run still needs from a person", () => {
  const base = {
    cycle: cycle([{ id: "tests", capability: "dynamic", status: "passed" }]),
    integrity: "valid" as const,
    signer: "untrusted" as const,
    executionTrust: "restricted" as const,
  };

  it("needs nobody where the run did nothing that calls for a decision", () => {
    expect(runVerdict(base).humanApproval).toBe("not-required");
  });

  it("reports an outstanding approval as required, never as rejected", () => {
    // Nobody said no. Nobody has said yes yet. Flattening those would let a run that never
    // asked read as one that was refused.
    const verdict = runVerdict({
      ...base,
      approvals: { required: ["network"], granted: [] },
    });

    expect(verdict.humanApproval).toBe("required");
    expect(verdict.reasons.humanApproval).toContain("network");
  });

  it("reports approved once every approval it needed was given", () => {
    expect(
      runVerdict({ ...base, approvals: { required: ["network"], granted: ["network"] } })
        .humanApproval,
    ).toBe("approved");
  });
});

describe("what a refused assessment says", () => {
  /**
   * The line a person read after a three-attempt escalation was "work refused: work refused:
   * required checks passed, lifecycle interrupted, ...": a prefix printed twice, and "passed"
   * standing for "no required checks were unmet" beside four failed gates. The reason names
   * what refused and nothing else, and carries no prefix of its own.
   */
  it("names only the conditions that refused", () => {
    const verdict = runVerdict({
      cycle: cycle([{ id: "tests", capability: "dynamic", status: "failed" }]),
      integrity: "valid",
      signer: "trusted",
      executionTrust: "restricted",
      assessment: {
        lifecycle: "interrupted",
        cancelled: true,
        settled: "escalated",
        baseRatchetAccepted: true,
        vacuousBlockingBonds: [],
        changedFiles: 3,
      },
    });

    expect(verdict.reasons.assessment).toBe(
      "the gates settled escalated; the run stopped as interrupted; the run was cancelled; " +
        "blocking gate(s) failed: tests; nothing executed the change: tests failed",
    );
  });

  it("names unmet required checks by id rather than saying passed for none", () => {
    const verdict = runVerdict({
      cycle: cycle([{ id: "tests", capability: "dynamic", status: "failed" }]),
      integrity: "valid",
      signer: "trusted",
      executionTrust: "restricted",
      assessment: {
        lifecycle: "completed",
        cancelled: false,
        settled: "green",
        baseRatchetAccepted: false,
        vacuousBlockingBonds: ["placeholder"],
        changedFiles: 3,
        requiredChecks: ["tests"],
      },
    });

    expect(verdict.reasons.assessment).toBe(
      "required checks unmet: tests; the base ratchet rejected the final state; vacuous blocking bonds: placeholder; " +
        "blocking gate(s) failed: tests; nothing executed the change: tests failed",
    );
    expect(verdict.reasons.assessment).not.toContain("passed");
  });
});

describe("final work assessment", () => {
  it.each([
    { baseRatchetAccepted: false },
    { cancelled: true },
    { lifecycle: "interrupted" },
    { lifecycle: "max-wall-time" },
    { vacuousBlockingBonds: ["tests"] },
    { settled: "escalated" },
  ])("refuses passed gates when final evidence refuses: %j", (refusal) => {
    const verdict = runVerdict({
      cycle: cycle([{ id: "tests", capability: "dynamic", status: "passed" }]),
      integrity: "valid",
      signer: "trusted",
      executionTrust: "restricted",
      assessment: {
        lifecycle: "completed",
        cancelled: false,
        settled: "green",
        baseRatchetAccepted: true,
        vacuousBlockingBonds: [],
        changedFiles: 3,
        ...refusal,
      },
    });
    expect(verdict.acceptable).toBe(false);
    expect(describeVerdict(verdict).join("\n")).toContain("acceptable: no");
  });
});

describe("an advisory demand for justification", () => {
  const settled = {
    lifecycle: "completed",
    cancelled: false,
    settled: "green",
    baseRatchetAccepted: true,
    vacuousBlockingBonds: [],
    changedFiles: 2,
  } as const;
  const overBudget = {
    id: "diff-budget",
    capability: "policy",
    status: "failed",
    severity: "advisory",
    measures: { justificationRequired: 1 },
  };
  const gates = cycle([{ id: "tests", capability: "dynamic", status: "passed" }, overBudget]);
  const budgetRecord = (gates as unknown as { runs: { record: string }[] }).runs[1]?.record ?? "";
  const base = {
    cycle: gates,
    integrity: "valid",
    signer: "trusted",
    executionTrust: "restricted",
  } as const;

  /**
   * The csstree upgrade of 2026-10-16: every blocking gate passed, the advisory budget asked for
   * a justification nobody requested, and the verdict refused the work while its reason said
   * the final ratchet and bonds had accepted it.
   */
  it("refuses an unanswered demand and names it as the reason", () => {
    const verdict = runVerdict({ ...base, assessment: settled });

    expect(verdict.acceptable).toBe(false);
    expect(verdict.policy).toBe("fail");
    expect(verdict.reasons.assessment).toBe(
      `diff-budget asked for a justification and no verified claim cites its record ${budgetRecord} (diff-budget failed)`,
    );
    expect(blockingReason(verdict)).toBe(verdict.reasons.assessment);
  });

  it("accepts the same work once a verified claim answers the demand", () => {
    const verdict = runVerdict({
      ...base,
      assessment: {
        ...settled,
        justifications: [{ gateRecord: budgetRecord, claimRecord: "sha256:claim" }],
      },
    });

    expect(verdict.acceptable).toBe(true);
    expect(verdict.policy).toBe("pass");
    expect(verdict.reasons.policy).toContain("justified by claim sha256:claim");
    expect(verdict.reasons.assessment).toBe(acceptedAssessmentReason);
  });

  it("never lets a justification answer a policy gate that made no demand", () => {
    const secrets = cycle([
      { id: "tests", capability: "dynamic", status: "passed" },
      { id: "secret-scan", capability: "policy", status: "failed", severity: "advisory" },
    ]);
    const secretRecord =
      (secrets as unknown as { runs: { record: string }[] }).runs[1]?.record ?? "";
    const verdict = runVerdict({
      ...base,
      cycle: secrets,
      assessment: {
        ...settled,
        justifications: [{ gateRecord: secretRecord, claimRecord: "sha256:claim" }],
      },
    });

    expect(verdict.acceptable).toBe(false);
    expect(verdict.reasons.assessment).toBe("policy gate(s) failed: secret-scan");
  });

  it("reads the task reason as the blocker when only a later verification refused", () => {
    const accepted = runVerdict({
      ...base,
      assessment: {
        ...settled,
        justifications: [{ gateRecord: budgetRecord, claimRecord: "sha256:claim" }],
      },
    });
    const refusedLater = {
      ...accepted,
      acceptable: false,
      reasons: {
        ...accepted.reasons,
        task: "final verification refused: the lockfile does not install",
      },
    };

    expect(blockingReason(refusedLater)).toBe(
      "final verification refused: the lockfile does not install",
    );
  });
});
