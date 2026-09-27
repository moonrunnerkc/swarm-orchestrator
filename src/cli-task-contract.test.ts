import { expect, it, vi } from "vitest";
import { presetTaskContract } from "./cli-task-contract.ts";
import { freezeGoalContract } from "./evidence/goal-contract.ts";
import { restrictFileSet } from "./gates/contract-scope.ts";
import { emptyFileSet } from "./gates/file-set.ts";

it("gives upgrade workers exact targets and enforces only the named migration paths", async () => {
  const goal = freezeGoalContract({
    version: 1,
    goal: "Upgrade parser",
    requirements: [{ id: "parse", description: "Preserve parsed values", checks: [] }],
    checks: [],
    immutablePaths: [],
    preset: {
      kind: "upgrade",
      manager: "npm",
      manifest: "package.json",
      lockfile: "package-lock.json",
      dependencies: [{ name: "is-number", section: "dependencies", version: "7.0.0" }],
      sourcePaths: ["src/parser.js"],
    },
  }).contract;
  const contract = presetTaskContract({
    goal,
    task: "Upgrade the dependency",
    maxSteps: 4,
    maxWallMs: 60000,
    network: "denied",
  });
  expect(contract.scopeKind).toBe("files");
  expect(contract.objective).toContain('"version":"7.0.0"');
  expect(contract.requiredChecks).toContain("task-acceptance");
  const declared = vi.fn(async () => emptyFileSet);
  const registry = restrictFileSet(
    {
      state: () => emptyFileSet,
      declare: declared,
      amend: async () => emptyFileSet,
    },
    contract,
  );
  expect(() => registry.declare(["unrelated.js"], "fixture")).toThrow(
    "outside controller-authorized scope",
  );
  await registry.declare(["src/parser.js"], "fixture");
  expect(declared).toHaveBeenCalledWith(["src/parser.js"], "fixture");
  expect(
    presetTaskContract({
      goal,
      task: contract.objective,
      originalObjective: contract.objective,
      maxSteps: 4,
      maxWallMs: 60000,
      network: "denied",
    }).objective,
  ).toBe(contract.objective);
});
