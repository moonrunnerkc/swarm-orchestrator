import { describe, expect, it } from "vitest";
import { findBlockingSecrets } from "../evidence/scrub.ts";
import { bondFor, bondVerdict } from "./bonds.ts";

const lookup = (gateId: string, types: readonly ("node" | "python" | "go" | "rust")[] = ["node"]) =>
  bondFor({ gateId, detectedTypes: types, maxAddedLines: 3 });

describe("which bond a gate has", () => {
  it("gives the tests gate a failing test file in the project's own runner shape", () => {
    expect(lookup("tests", ["node"])?.files[0]?.path).toBe("swarm-falsification-bond.test.js");
    expect(lookup("tests", ["python"])?.files[0]?.path).toBe("test_swarm_falsification_bond.py");
    expect(lookup("tests", ["go"])?.files[0]?.path).toBe("swarmfalsificationbond/bond_test.go");
    expect(lookup("tests", ["rust"])?.files[0]?.path).toBe("tests/swarm_falsification_bond.rs");
    expect(lookup("tests", ["node"])?.provable).toBe(false);
  });

  it("reads the type off a polyglot gate id rather than off the first detected type", () => {
    expect(lookup("tests:python", ["node", "python"])?.files[0]?.path).toBe(
      "test_swarm_falsification_bond.py",
    );
  });

  it("bonds every inspection, and knows the inspection saw the file", () => {
    for (const id of ["placeholder", "secret-scan", "file-set", "diff-budget"]) {
      const bond = lookup(id);
      expect(bond, id).not.toBeNull();
      expect(bond?.provable, id).toBe(true);
      expect(bond?.files).toHaveLength(1);
    }
  });

  it("makes the diff-budget bond one line over the budget it was given", () => {
    const bond = bondFor({ gateId: "diff-budget", detectedTypes: ["node"], maxAddedLines: 3 });
    expect(bond?.files[0]?.content.trimEnd().split("\n")).toHaveLength(4);
  });

  it("carries a placeholder marker and a credential the gates actually refuse", () => {
    expect(lookup("placeholder")?.files[0]?.content).toMatch(/\bTODO\b/);
    const secret = lookup("secret-scan")?.files[0]?.content ?? "";
    expect(findBlockingSecrets(secret).length).toBeGreaterThan(0);
  });

  it("has no bond for a check it cannot add a file to, and says so with null", () => {
    expect(lookup("behaviour-probe")).toBeNull();
    expect(lookup("typecheck", ["node"])).toBeNull();
    expect(lookup("lint", ["rust"])).toBeNull();
    expect(lookup("tests", [])).toBeNull();
  });

  it("names every bond file after the bond, so a project's own file is never overwritten", () => {
    for (const id of [
      "tests",
      "typecheck",
      "lint",
      "format",
      "placeholder",
      "secret-scan",
      "file-set",
      "diff-budget",
    ]) {
      for (const type of ["node", "python", "go", "rust"] as const) {
        for (const file of lookup(id, [type])?.files ?? []) {
          expect(file.path).toMatch(/swarm.?falsification.?bond/);
        }
      }
    }
  });
});

describe("what a bond showed", () => {
  const counts = { collectedBefore: null, collectedAfter: null };

  it("held where the check refused the bond", () => {
    expect(bondVerdict({ observed: "failed", provable: false, ...counts })).toBe("held");
  });

  it("is vacuous where an inspection passed over a file it was handed", () => {
    expect(bondVerdict({ observed: "passed", provable: true, ...counts })).toBe("vacuous");
  });

  it("is vacuous where a test runner collected the bond and passed anyway", () => {
    expect(
      bondVerdict({ observed: "passed", provable: false, collectedBefore: 3, collectedAfter: 4 }),
    ).toBe("vacuous");
  });

  it("is unshown where a command passed and nothing says it saw the bond", () => {
    expect(bondVerdict({ observed: "passed", provable: false, ...counts })).toBe("unshown");
    expect(
      bondVerdict({ observed: "passed", provable: false, collectedBefore: 3, collectedAfter: 3 }),
    ).toBe("unshown");
  });

  it("is not measured where the check could not run", () => {
    expect(bondVerdict({ observed: "not-applicable", provable: true, ...counts })).toBe(
      "not-measured",
    );
  });
});
