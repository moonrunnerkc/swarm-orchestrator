import { expect, it } from "vitest";
import type { GateCycle } from "./gate-runner.ts";
import { classifyRepair, decideEscalation, escalationSettingsSchema } from "./repair-policy.ts";

const settings = escalationSettingsSchema.parse({
  target: "local:alternate",
  trigger: "repeated-failure",
  maximum: 1,
  reservedTokens: 4096,
  reserveMs: 30000,
});
const observed = {
  settings,
  classification: "implementation" as const,
  signature: "tests:assertion failed",
  previousSignature: "tests:assertion failed",
  count: 0,
  remainingTokens: 20000,
  remainingMs: 60000,
  unknownUsage: false,
};
it("escalates exactly once for repeated observed failure, regardless of source churn", () => {
  expect(decideEscalation(observed)).toBe("escalate");
  expect(decideEscalation({ ...observed, count: 1 })).toBe("stop");
  expect(decideEscalation({ ...observed, previousSignature: "another failure" })).toBe("continue");
});
it.each([
  "setup",
  "infrastructure",
  "instrument",
  "held-expectation",
  "permission",
  "unknown",
] as const)("does not spend escalation on %s", (classification) => {
  expect(decideEscalation({ ...observed, classification })).toBe("stop");
});
it("reserves verification budget and refuses unknown usage", () => {
  expect(decideEscalation({ ...observed, remainingTokens: 4096 })).toBe("stop");
  expect(decideEscalation({ ...observed, remainingMs: 30000 })).toBe("stop");
  expect(decideEscalation({ ...observed, unknownUsage: true })).toBe("stop");
});
it("rejects unsupported effort or an increased escalation cap", () => {
  expect(escalationSettingsSchema.safeParse({ ...settings, effort: "high" }).success).toBe(false);
  expect(escalationSettingsSchema.safeParse({ ...settings, maximum: 2 }).success).toBe(false);
});

it("stops repair where every failing gate says its failures are held checks", () => {
  const failing = (gateId: string, measures: Record<string, number>) =>
    ({
      gateId,
      kind: "inspection",
      capability: "dynamic",
      severity: "blocking",
      status: "failed",
      detail: "",
      measures,
      parts: {},
      observation: { exitCode: 1, stdout: "", stderr: "", durationMs: 0, unavailable: null },
    }) as unknown as GateCycle["runs"][number];
  const cycle = (runs: GateCycle["runs"]) =>
    ({ runs, blockingFailures: runs }) as unknown as GateCycle;

  // A stopping decision of its own, never the class of a defect in the checking itself.
  expect(classifyRepair(cycle([failing("diagnostics", { unrepairable: 1 })])).kind).toBe(
    "held-expectation",
  );
  // Another failure beside it is still the implementation's to repair.
  expect(
    classifyRepair(cycle([failing("diagnostics", { unrepairable: 1 }), failing("tests", {})])).kind,
  ).toBe("implementation");
});

it("repairs a lint finding beside an acceptance reading the change left unmeasured, and stops on setup", () => {
  const failing = (gateId: string, stderr: string) =>
    ({
      gateId,
      kind: "inspection",
      capability: "dynamic",
      severity: "blocking",
      status: "failed",
      detail: "",
      measures: {},
      parts: {},
      observation: { exitCode: 1, stdout: "", stderr, durationMs: 0, unavailable: null },
    }) as unknown as GateCycle["runs"][number];
  const cycle = (runs: GateCycle["runs"]) =>
    ({ runs, blockingFailures: runs }) as unknown as GateCycle;
  const lint = failing("lint", "[warn] test/query.test.ts");
  expect(
    classifyRepair(
      cycle([lint, failing("task-acceptance", "regression unmeasured: a check fails at the base")]),
    ).kind,
  ).toBe("implementation");
  expect(
    classifyRepair(cycle([lint, failing("task-acceptance", "setup unavailable: no runner")])).kind,
  ).toBe("setup");
});
