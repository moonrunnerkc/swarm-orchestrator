import { describe, expect, it } from "vitest";
import { approvalsRequiredFor, describeApprovalRequest, riskOf } from "./approval.ts";

/**
 * Approval spam is what makes a person stop reading approvals. So the question is not "did
 * something happen" but "would a mistake here be expensive and hard to undo", and the answer is
 * read off what the action is rather than off how the model described it.
 */
describe("what needs a person", () => {
  it("needs nobody for an ordinary edit inside the declared scope", () => {
    expect(
      approvalsRequiredFor({
        network: "denied",
        installsDependencies: false,
        usesSecrets: false,
        widensScope: false,
        lands: false,
        destructive: false,
        policyException: false,
      }),
    ).toEqual([]);
  });

  it("needs one for turning the network on, whatever else the run is doing", () => {
    const required = approvalsRequiredFor({
      network: "unrestricted",
      installsDependencies: false,
      usesSecrets: false,
      widensScope: false,
      lands: false,
      destructive: false,
      policyException: false,
    });

    expect(required).toContain("network");
  });

  it("needs one for each of the things the mission names, and names them separately", () => {
    const required = approvalsRequiredFor({
      network: "unrestricted",
      installsDependencies: true,
      usesSecrets: true,
      widensScope: true,
      lands: true,
      destructive: true,
      policyException: true,
    });

    expect([...required].sort()).toEqual(
      [
        "dependencies",
        "destructive",
        "landing",
        "network",
        "policy-exception",
        "scope",
        "secrets",
      ].sort(),
    );
  });

  it("reads risk off what the action is, never off what the model said about it", () => {
    expect(riskOf({ lands: true })).toBe("high");
    expect(riskOf({ destructive: true })).toBe("high");
    expect(riskOf({ widensScope: true })).toBe("medium");
    expect(riskOf({})).toBe("low");
  });

  it("says what is being asked and what happens either way", () => {
    const asked = describeApprovalRequest("network", { reason: "the tests fetch a fixture" });

    expect(asked).toMatch(/network/i);
    expect(asked).toMatch(/the tests fetch a fixture/);
    expect(asked).toMatch(/refused|denied|no/i);
  });

  it("refuses to describe a subject it does not have a rule for", () => {
    expect(() => describeApprovalRequest("teleport" as never, { reason: "x" })).toThrow(/teleport/);
  });
});
