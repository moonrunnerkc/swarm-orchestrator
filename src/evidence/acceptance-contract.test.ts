import { expect, it } from "vitest";
import { freezeAcceptanceContract } from "./acceptance-contract.ts";
import { digestOfBytes } from "./canonical-json.ts";

it("binds each requirement to an immutable instrument and explicit controls", () => {
  const digest = digestOfBytes("fixture");
  const requirement = {
    id: "omitted-flag",
    artifactDigest: digest,
    argv: ["node", "flag.test.mjs"],
    severity: "required",
    applicable: true,
    referenceDigest: digest,
    violatingControlDigest: digest,
  };
  const input = {
    version: 1,
    author: "external author",
    taskId: "task",
    exposure: "public",
    immutablePaths: ["flag.test.mjs"],
    requirements: [requirement],
  };
  const frozen = freezeAcceptanceContract(input);
  expect(() => frozen.contract.requirements[0]?.argv.push("ignored")).toThrow();
  expect(() =>
    freezeAcceptanceContract({ ...input, requirements: [requirement, requirement] }),
  ).toThrow(/unique/);
});
