import { describe, expect, it } from "vitest";
import { freezeProtocol, protocolSchedule } from "./protocol.ts";
import { campaignProtocolFixture } from "./protocol-fixture.ts";

describe("campaign precommitment", () => {
  it("refuses duplicated sampling units even under different case labels", () => {
    const protocol = campaignProtocolFixture();
    protocol.cases.push({
      ...(protocol.cases[0] ??
        (() => {
          throw new Error("fixture schedule is empty");
        })()),
      id: "renamed",
    });
    expect(() => freezeProtocol(protocol)).toThrow(/duplicate repository/);
  });
  it("freezes nested fields and binds the full schedule to its protocol", () => {
    const protocol = campaignProtocolFixture();
    const frozen = freezeProtocol(protocol);
    expect(() => frozen.protocol.seeds.push(2)).toThrow();
    protocol.budgets.tokens += 1;
    expect(freezeProtocol(protocol).digest).not.toBe(frozen.digest);
    expect(protocolSchedule(protocol)[0]?.executionId).not.toBe(
      protocolSchedule(frozen.protocol)[0]?.executionId,
    );
  });
  it("counterbalances paired order without creating more independent units from seeds", () => {
    const protocol = campaignProtocolFixture();
    protocol.cases.push({
      ...(protocol.cases[0] ??
        (() => {
          throw new Error("fixture schedule is empty");
        })()),
      id: "two",
      repository: "repo-two",
    });
    expect(protocolSchedule(protocol).map((entry) => entry.armId)).toEqual([
      "baseline",
      "candidate",
      "candidate",
      "baseline",
    ]);
  });
});
