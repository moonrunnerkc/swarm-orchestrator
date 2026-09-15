import { expect, it } from "vitest";
import { freezeProtocol, protocolSchedule } from "./protocol.ts";
import { goalCampaignProtocolFixture } from "./protocol-fixture.ts";

it("counts distinct goals and repositories without turning repeats into new goals", () => {
  const protocol = goalCampaignProtocolFixture();
  protocol.seeds = [1, 2, 3];
  const sealed = freezeProtocol(protocol);
  expect(sealed.protocol.version).toBe(2);
  const schedule = protocolSchedule(sealed.protocol);
  expect(schedule).toHaveLength(360);
  expect(new Set(schedule.map((entry) => entry.caseId)).size).toBe(24);
  expect(new Set(schedule.map((entry) => entry.repository)).size).toBe(8);
  expect(schedule.slice(0, 5).map((entry) => entry.armId)).not.toEqual(
    schedule.slice(5, 10).map((entry) => entry.armId),
  );
  expect(() => sealed.protocol.cases.pop()).toThrow();
});

it("requires the pilot population, ablations and preserved requirement identities", () => {
  const protocol = goalCampaignProtocolFixture();
  expect(() => freezeProtocol({ ...protocol, cases: protocol.cases.slice(0, 23) })).toThrow();
  expect(() =>
    freezeProtocol({
      ...protocol,
      cases: protocol.cases.map((goal) => ({ ...goal, repository: "one" })),
    }),
  ).toThrow();
  expect(() =>
    freezeProtocol({ ...protocol, arms: protocol.arms.filter((arm) => arm.role !== "no-peer") }),
  ).toThrow();
  expect(() => freezeProtocol({ ...protocol, comparisonCases: ["undeclared"] })).toThrow();
  expect(() =>
    freezeProtocol({
      ...protocol,
      exposure: "held-out",
      cases: protocol.cases.map((goal) => ({ ...goal, previouslyExposed: true })),
    }),
  ).toThrow();
  expect(() =>
    freezeProtocol({
      ...protocol,
      cases: protocol.cases.map((goal) => ({ ...goal, requirementIds: [] })),
    }),
  ).toThrow();
});
