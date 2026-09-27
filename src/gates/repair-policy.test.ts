import { expect, it } from "vitest";
import { decideEscalation, escalationSettingsSchema } from "./repair-policy.ts";

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
it.each(["setup", "infrastructure", "permission", "unknown"] as const)(
  "does not spend escalation on %s",
  (classification) => {
    expect(decideEscalation({ ...observed, classification })).toBe("stop");
  },
);
it("reserves verification budget and refuses unknown usage", () => {
  expect(decideEscalation({ ...observed, remainingTokens: 4096 })).toBe("stop");
  expect(decideEscalation({ ...observed, remainingMs: 30000 })).toBe("stop");
  expect(decideEscalation({ ...observed, unknownUsage: true })).toBe("stop");
});
it("rejects unsupported effort or an increased escalation cap", () => {
  expect(escalationSettingsSchema.safeParse({ ...settings, effort: "high" }).success).toBe(false);
  expect(escalationSettingsSchema.safeParse({ ...settings, maximum: 2 }).success).toBe(false);
});
