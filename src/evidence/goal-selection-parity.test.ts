import { expect, it } from "vitest";
import { asJsonValue, digestOfJson, type JsonValue } from "./canonical-json.ts";
import type { LedgerRecord, RecordType } from "./ledger-record.ts";
import { goalSelectionConformance } from "./verifier/verify.mjs";

type Observation = Pick<LedgerRecord, "type" | "sequence" | "actor" | "payloadDigest">;

function capturedComparison(reportedUsage = false) {
  const records: Observation[] = [];
  const payloads = new Map<string, JsonValue>();
  const append = (type: RecordType, value: unknown) => {
    const payload = asJsonValue(value);
    const payloadDigest = digestOfJson(payload);
    records.push({ type, sequence: records.length, actor: "harness", payloadDigest });
    payloads.set(payloadDigest, payload);
    return payloadDigest;
  };
  append("goal-contract", {
    contract: {
      selection: "cost",
      requirements: [
        { id: "read", checks: ["read"] },
        { id: "write", checks: ["write"] },
      ],
    },
  });
  const candidates = ["omission", "early", "late"].map((workerId, attemptIndex) => {
    append("controller-candidate", {
      workerId,
      taskId: "goal",
      baseCommit: "base",
      attemptIndex,
      green: true,
    });
    if (reportedUsage) {
      append("controller-event", { kind: "usage-reserved", activity: workerId, id: workerId });
      append("controller-event", {
        kind: "usage-settled",
        id: workerId,
        status: "reported",
        inputTokens: 10,
        outputTokens: 20,
      });
    }
    const accepted = workerId !== "omission";
    const goal = {
      tree: workerId,
      accepted,
      obligations: [
        { id: "read", status: "accepted" },
        { id: "write", status: accepted ? "accepted" : "rejected" },
      ],
    };
    append("goal-verification", goal);
    const verification = append("goal-candidate-verification", {
      workerId,
      baseCommit: "base",
      tree: workerId,
      changedFiles: 1,
      changedLines: accepted ? 10 : 1,
      verification: { verified: accepted, regression: "pass", checks: [], goalAcceptance: goal },
    });
    return {
      workerId,
      baseCommit: "base",
      attemptIndex,
      regressionPassed: true,
      obligations: [
        { id: "read", accepted: true },
        { id: "write", accepted },
      ],
      tokenCount: reportedUsage ? 30 : null,
      changedFiles: 1,
      changedLines: accepted ? 10 : 1,
      verification,
      eligible: accepted,
      reason: accepted ? null : "unaccepted requirements: write",
    };
  });
  const selection = {
    policy: "complete-goal-selection-v1",
    objective: "reported-model-tokens",
    taskId: "goal",
    baseCommit: "base",
    candidates,
    order: ["early", "late"],
    winner: "early",
    abstentions: reportedUsage
      ? []
      : ["provider token usage was not measured; monetary cost is also unavailable"],
  };
  const digest = append("goal-attempt-selection", selection);
  return { records, payloads, selection, digest };
}

it.each([false, true])(
  "independently accepts the known complete candidates in stable order (reported=%s)",
  (reported) => {
    const fixture = capturedComparison(reported);
    expect(goalSelectionConformance(fixture.records, fixture.payloads)).toEqual([
      { sequence: fixture.records.length - 1, problems: [] },
    ]);
  },
);

it.each([
  [
    "omission",
    (selection: ReturnType<typeof capturedComparison>["selection"]) => {
      selection.order = ["omission", "early", "late"];
      selection.winner = "omission";
    },
  ],
  [
    "stable tie",
    (selection: ReturnType<typeof capturedComparison>["selection"]) => {
      selection.order = ["late", "early"];
      selection.winner = "late";
    },
  ],
  [
    "usage",
    (selection: ReturnType<typeof capturedComparison>["selection"]) => {
      const candidate = selection.candidates[1];
      if (candidate) candidate.tokenCount = 0;
    },
  ],
  [
    "base",
    (selection: ReturnType<typeof capturedComparison>["selection"]) => {
      const candidate = selection.candidates[1];
      if (candidate) candidate.baseCommit = "another";
    },
  ],
  [
    "eligibility",
    (selection: ReturnType<typeof capturedComparison>["selection"]) => {
      const candidate = selection.candidates[0];
      if (candidate) {
        candidate.eligible = true;
        candidate.reason = null;
      }
    },
  ],
  [
    "observations",
    (selection: ReturnType<typeof capturedComparison>["selection"]) => {
      const candidate = selection.candidates[0];
      if (candidate)
        candidate.obligations = [
          { id: "read", accepted: true },
          { id: "write", accepted: true },
        ];
    },
  ],
  [
    "abstention",
    (selection: ReturnType<typeof capturedComparison>["selection"]) => {
      selection.abstentions = [];
    },
  ],
] as const)("refuses a signed selection that forges %s", (_name, mutate) => {
  const fixture = capturedComparison();
  mutate(fixture.selection);
  fixture.payloads.set(fixture.digest, asJsonValue(fixture.selection));
  expect(
    goalSelectionConformance(fixture.records, fixture.payloads)[0]?.problems.length,
  ).toBeGreaterThan(0);
});

it("does not let one candidate cite another candidate's successful verification", () => {
  const fixture = capturedComparison();
  const omitted = fixture.selection.candidates[0];
  const complete = fixture.selection.candidates[1];
  if (!omitted || !complete) throw new Error("fixture candidates missing");
  omitted.verification = complete.verification;
  fixture.payloads.set(fixture.digest, asJsonValue(fixture.selection));
  expect(goalSelectionConformance(fixture.records, fixture.payloads)[0]?.problems).toContain(
    "goal candidate cites another attempt's verification",
  );
});
