import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  assertPresetSelection,
  presetTaskContract,
  readGoalContractFile,
} from "./cli-task-contract.ts";
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

const featureGoal = freezeGoalContract({
  version: 1,
  goal: "serve a --no-cache flag",
  requirements: [{ id: "flag", description: "the flag disables caching", checks: [] }],
  checks: [],
  immutablePaths: ["tests/"],
}).contract;

it("gives a feature task the whole workspace, its sealed objective and the acceptance check", () => {
  const contract = presetTaskContract({
    goal: featureGoal,
    task: "add --no-cache",
    maxSteps: 4,
    maxWallMs: 60000,
    network: "unrestricted",
  });
  expect(contract.scopeKind).toBe("workspace");
  expect(contract.immutablePaths).toEqual(["tests"]);
  expect(contract.requiredChecks).toEqual(["task-acceptance"]);
  expect(contract.objective).toContain("Sealed objective: serve a --no-cache flag");
  expect(contract.objective).toContain("Preset: null");
});

it("names a preset in both places or in neither", () => {
  expect(() => assertPresetSelection(undefined, featureGoal)).not.toThrow();
  expect(() => assertPresetSelection("bugfix", featureGoal)).toThrow(
    "the goal contract carries no preset",
  );
  const upgrade = freezeGoalContract({
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
      sourcePaths: [],
    },
  }).contract;
  expect(() => assertPresetSelection(undefined, upgrade)).toThrow(
    "pass --preset upgrade to run under that policy (with --install)",
  );
  expect(() => assertPresetSelection("bugfix", upgrade)).toThrow(
    "--preset bugfix does not match the upgrade preset",
  );
  expect(() => assertPresetSelection("upgrade", upgrade)).not.toThrow();
});

it("names the contract file and what is wrong with it", async () => {
  const root = await mkdtemp(join(tmpdir(), "swarm-contract-file-"));
  try {
    await expect(readGoalContractFile(join(root, "missing.json"))).rejects.toThrow(
      "missing.json cannot be read",
    );
    await writeFile(join(root, "broken.json"), "{");
    await expect(readGoalContractFile(join(root, "broken.json"))).rejects.toThrow(
      "broken.json is not JSON",
    );
    await writeFile(join(root, "invalid.json"), JSON.stringify({ version: 1 }));
    await expect(readGoalContractFile(join(root, "invalid.json"))).rejects.toThrow(
      "invalid.json is not a valid goal contract",
    );
    await writeFile(join(root, "good.json"), JSON.stringify(featureGoal));
    expect((await readGoalContractFile(join(root, "good.json"))).goal).toBe(featureGoal.goal);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("names each requirement no generated check covers in the worker's brief, with why and what to do", () => {
  const goal = freezeGoalContract({
    version: 1,
    goal: 'slugify turns spaces into dashes, and "Hello World" must still read "hello-world"',
    requirements: [
      {
        id: "kept",
        description: "Hello World reads hello-world",
        checks: [],
        planned: { quote: '"Hello World" must still read "hello-world"', diagnostics: [] },
      },
    ],
    checks: [],
    immutablePaths: [],
  }).contract;
  const contract = presetTaskContract({
    goal,
    task: "slugify turns spaces into dashes",
    maxSteps: 4,
    maxWallMs: 60000,
    network: "denied",
    uncovered: [
      {
        id: "kept",
        quote: '"Hello World" must still read "hello-world"',
        reason:
          'kept-forms: the base gave "Hello World" for "Hello World", an input the task names',
        nextAction: "implement it from the task's words",
      },
    ],
  });
  expect(contract.objective).toContain(
    "Requested behaviour no generated check exercises (the planner's reading of the task;",
  );
  expect(contract.objective).toContain(
    '- kept, quoting the task: "\\"Hello World\\" must still read \\"hello-world\\"". Why: kept-forms: the base gave "Hello World" for "Hello World", an input the task names. Next: implement it from the task\'s words.',
  );
});

it("adds nothing to the brief when every planned requirement has a check", () => {
  const contract = presetTaskContract({
    goal: featureGoal,
    task: "serve a --no-cache flag",
    maxSteps: 4,
    maxWallMs: 60000,
    network: "denied",
    uncovered: [],
  });
  expect(contract.objective).not.toContain("no generated check exercises");
});

it("names an unresolved outcome in the brief though another outcome of its requirement is checked", () => {
  // csv-split: quoted fields keep their commas (checked), and an empty trailing field is kept
  // (its only check refused). One requirement, two outcomes; the brief names the second alone.
  const goal = freezeGoalContract({
    version: 1,
    goal: "split CSV lines",
    requirements: [
      {
        id: "fields",
        description: "split a line into fields",
        checks: [],
        planned: { quote: "a quoted field keeps its commas", diagnostics: ["quoted-commas"] },
      },
    ],
    checks: [
      {
        id: "quoted-commas",
        command: "planned check",
        author: "model",
        exposure: "shared",
        artifacts: [],
      },
    ],
    immutablePaths: [],
  }).contract;
  const contract = presetTaskContract({
    goal,
    task: "split CSV lines: a quoted field keeps its commas, and a trailing comma gives an empty last field",
    maxSteps: 4,
    maxWallMs: 60000,
    network: "denied",
    uncovered: [],
    unresolvedOutcomes: [
      {
        id: "fields#2",
        requirement: "fields",
        quote: "a trailing comma gives an empty last field",
        role: "change",
        reason: "trailing-empty: case 1 threw in the check program's own code on the base",
        nextAction: "implement it from the task's words",
      },
    ],
  });
  expect(contract.objective).toContain(
    "- fields#2, a change under requirement fields, quoting the task: \"a trailing comma gives an empty last field\". Why: trailing-empty: case 1 threw in the check program's own code on the base. Next: implement it from the task's words.",
  );
  expect(contract.objective).not.toContain('a quoted field keeps its commas". Why');
});

it("names the task's own input of an unresolved outcome, with what was expected and what the base gave", () => {
  const goal = freezeGoalContract({
    version: 1,
    goal: "links",
    requirements: [{ id: "visible", description: "the visible check", checks: ["visible"] }],
    checks: [
      {
        id: "visible",
        command: "node check.mjs",
        author: "user",
        exposure: "shared",
        artifacts: [],
      },
    ],
    immutablePaths: [],
  }).contract;
  const contract = presetTaskContract({
    goal,
    task: 'a scheme of any case links, so "(See hTtPS://example.com/x.)" must still produce a link',
    maxSteps: 4,
    maxWallMs: 60000,
    network: "denied",
    unresolvedOutcomes: [
      {
        id: "scheme#1",
        requirement: "scheme",
        quote: null,
        role: "keep",
        taskInputs: [
          {
            input: "(See hTtPS://example.com/x.)",
            expected: '{"hasLink":true}',
            base: '{"hasLink":false}',
          },
        ],
        reason: "scheme-check: its cases do not hold the task's own input",
        nextAction: "run the project on it yourself",
      },
    ],
  });
  // Named however the planner later described the requirement.
  expect(contract.objective).toContain(
    'The task\'s own input: "(See hTtPS://example.com/x.)" (the planner first expected {"hasLink":true}; the unchanged base gives {"hasLink":false}).',
  );
});
