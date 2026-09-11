import { expect, it } from "vitest";
import { digestOfBytes } from "../../src/evidence/canonical-json.ts";
import { contractPackage } from "./contracts.mjs";

it("binds supplied requirement vectors and distinct control patches into the package", () => {
  const checks = [{ input: { page: 0 }, expected: { error: "Invalid page" } }];
  const pack = contractPackage({ id: "check-pages", checks }, "reference patch", "omission patch");
  const requirement = pack.contract.requirements[0];
  expect(requirement.referenceDigest).not.toBe(requirement.violatingControlDigest);
  const artifact = pack.artifacts[requirement.artifactDigest];
  expect(digestOfBytes(artifact)).toBe(requirement.artifactDigest);
  expect(artifact).toContain("from '../solution.mjs'");
  expect(artifact).toContain(JSON.stringify(checks));
  expect(requirement.severity).toBe("required");
  expect(pack.contract.author).toContain("no independent human review");
});
