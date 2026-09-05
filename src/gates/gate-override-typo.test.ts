import { describe, expect, it } from "vitest";
import { assembleGates, UnknownGateOverrideError } from "./default-gates.ts";

const detection = {
  types: ["node"],
  nodeScriptCommands: { test: "node --test", lint: "eslint .", typecheck: "tsc --noEmit" },
} as never;

/**
 * An override id that is not an assembled gate adds a gate, which is a real feature: a project
 * with a `build` step wants it checked. A near miss is a different thing. `tets` intending
 * `tests` used to add a second blocking gate and leave the assembled tests gate running its own
 * command, so the run did more work than the author asked for and none of the work they meant.
 */
describe("a gate override naming an id the assembled set does not have", () => {
  it("refuses a near miss and names what it was probably meant to be", () => {
    const attempt = () =>
      assembleGates(detection, { commandOverrides: { tets: "npm run test:fast" } });

    expect(attempt).toThrow(UnknownGateOverrideError);
    expect(attempt).toThrow(/tets/);
    expect(attempt).toThrow(/tests/);
  });

  it("still adds a gate under an id that is nothing like an assembled one", () => {
    const gates = assembleGates(detection, { commandOverrides: { build: "npm run build" } });

    expect(gates.map((gate) => gate.id)).toContain("build");
  });

  it("still replaces an assembled gate named exactly", () => {
    const gates = assembleGates(detection, { commandOverrides: { tests: "npm run test:fast" } });

    const tests = gates.filter((gate) => gate.id === "tests");
    expect(tests).toHaveLength(1);
    expect(tests[0]?.source).toMatchObject({ command: "npm run test:fast" });
  });

  it("names every near miss at once, rather than one per run", () => {
    const attempt = () =>
      assembleGates(detection, {
        commandOverrides: { tets: "a", linr: "b" },
      });

    expect(attempt).toThrow(/tets/);
    expect(attempt).toThrow(/linr/);
  });
});
