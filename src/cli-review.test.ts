import { describe, expect, it } from "vitest";
import type { ReviewProbe } from "./agent-review.ts";
import { probeContract } from "./cli-review.ts";
import { freezeGoalContract } from "./evidence/goal-contract.ts";
import { plannedCheckRunner } from "./workers/planned-check-program.ts";

const probe: ReviewProbe = {
  id: "trims-names",
  basis: "preserve",
  keeps: "label trims",
  program: "import { label } from './label.mjs';\nexport default (input) => label(input.name);\n",
  cases: [{ input: { name: " ann " } }, { input: { name: "bob" } }],
};

describe("the review's probes as a contract", () => {
  it("runs every probe twice through the planned-check runner and decides nothing", () => {
    const contract = probeContract([probe]);
    expect(freezeGoalContract(contract).contract).toEqual(contract);
    expect(contract.checks.map((one) => one.id)).toEqual([
      "trims-names-run-1",
      "trims-names-run-2",
    ]);
    expect(contract.requirements).toEqual([
      expect.objectContaining({
        id: "candidate-review",
        checks: [],
        planned: { diagnostics: ["trims-names-run-1", "trims-names-run-2"] },
      }),
    ]);
    for (const check of contract.checks) {
      expect(check.author).toBe("model");
      expect(check.behavior?.kind).toBe("cli");
      if (check.behavior?.kind !== "cli") continue;
      expect(check.behavior.argv).toEqual([
        "node",
        "--input-type=module",
        "-e",
        plannedCheckRunner,
      ]);
      // The runner's lines are read back as they are: nothing compares them with an expectation.
      expect(check.behavior.stdout).toEqual([]);
      expect(JSON.parse(check.behavior.stdin)).toEqual({
        program: probe.program,
        inputs: [{ name: " ann " }, { name: "bob" }],
      });
    }
  });
});
