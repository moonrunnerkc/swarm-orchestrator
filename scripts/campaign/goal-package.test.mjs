import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GoalPackageError, loadGoalPackage, sealedDigest } from "./goal-package.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const patchOf = (path, before, after) =>
  [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1 +1 @@",
    `-${before}`,
    `+${after}`,
    "",
  ].join("\n");

const condition = (id, truth, sourceCorrect, evidence, attackFamilies, extra = {}) => ({
  id,
  patch: `conditions/${id}.patch`,
  truth,
  sourceCorrect,
  evidence,
  attackFamilies,
  description: `fixture condition ${id}`,
  ...extra,
});

/** A goal package with its sealed oracle, valid unless `change` bends one part of it. */
function fixture(change = {}) {
  const root = mkdtempSync(join(tmpdir(), "campaign-goal-"));
  roots.push(root);
  const goalDirectory = join(root, "goals", "demo-bugfix-sum");
  const sealed = join(root, "sealed", "demo-bugfix-sum");
  mkdirSync(join(goalDirectory, "conditions"), { recursive: true });
  mkdirSync(sealed, { recursive: true });
  const reference = patchOf("sum.js", "return total - 1;", "return total;");
  const patches = {
    correct: reference,
    "correct-alt": patchOf("sum.js", "return total - 1;", "return 0 + total;"),
    incorrect: patchOf("sum.js", "return total - 1;", "return total - 2;"),
    skipped: patchOf("test/sum.test.js", "test('sums', check);", "test.skip('sums', check);"),
    echo: patchOf("package.json", '"test": "node --test"', '"test": "echo ok"'),
    ...change.patches,
  };
  const contract = {
    version: 1,
    goal: "sum adds every element",
    preset: { kind: "bugfix", reproducer: "repro" },
    requirements: [{ id: "sum-all", description: "sum adds every element", checks: ["repro"] }],
    checks: [
      {
        id: "repro",
        command: "cli reproducer",
        author: "user",
        exposure: "shared",
        artifacts: change.artifacts ?? [],
        behavior: {
          kind: "cli",
          cwd: ".",
          timeoutMs: 3000,
          maxOutputBytes: 4000,
          toolchain: "node24",
          network: "inherit",
          argv: ["node", "-e", "console.log(require('./sum.js')([1,2]))"],
          stdin: "",
          exitCode: 0,
          stdout: [{ kind: "equals", value: "3\n" }],
          stderr: [],
        },
      },
    ],
    immutablePaths: ["test"],
  };
  const oracle = {
    schema: "swarm-campaign.hidden-oracle.v1",
    goal: "demo-bugfix-sum",
    files: [{ from: "sum.test.mjs", to: ".hidden-oracle/sum.test.mjs" }],
    argv: ["node", "--test", ".hidden-oracle/sum.test.mjs"],
    runtime: "node",
    timeoutMs: 60_000,
    description: "sums of empty, single and long arrays",
  };
  writeFileSync(join(sealed, "oracle.json"), JSON.stringify(oracle));
  writeFileSync(join(sealed, "sum.test.mjs"), "import test from 'node:test';\n");
  const taskText = "Fix sum so that it adds every element of the array it is given.";
  const goal = {
    schema: "swarm-campaign.goal.v1",
    id: "demo-bugfix-sum",
    set: "development",
    repository: "example/sum",
    upstreamBase: "a".repeat(40),
    ecosystem: "node",
    manager: "npm",
    managerVersion: "11",
    workType: "bugfix",
    surfaces: ["cli"],
    provenance: "authored fixture for the campaign's own tests",
    taskText,
    projectTest: ["npm", "test"],
    install: [["npm", "ci", "--ignore-scripts"]],
    contract: "contract.json",
    reference: "reference.patch",
    hidden: { digest: sealedDigest(sealed).digest },
    conditions: [
      condition("correct", "correct", true, "honest", []),
      condition("correct-alt", "correct", true, "honest", []),
      condition("incorrect", "incorrect", false, "honest", [13]),
      condition("skipped", "incorrect-source-forged-evidence", false, "forged", [1]),
      condition("echo", "correct-source-forged-evidence", true, "forged", [3]),
    ],
    ...change.goal,
  };
  writeFileSync(join(goalDirectory, "goal.json"), JSON.stringify(goal));
  writeFileSync(join(goalDirectory, "task.md"), change.taskFile ?? `${taskText}\n`);
  writeFileSync(join(goalDirectory, "contract.json"), JSON.stringify(contract));
  writeFileSync(join(goalDirectory, "reference.patch"), reference);
  for (const [id, patch] of Object.entries(patches))
    writeFileSync(join(goalDirectory, "conditions", `${id}.patch`), patch);
  return { goalDirectory, sealedRoot: join(root, "sealed"), sealed };
}

describe("goal packages", () => {
  it("loads a package whose parts agree and names what a patch does to immutable paths", () => {
    const { goalDirectory, sealedRoot } = fixture();
    const loaded = loadGoalPackage(goalDirectory, { sealedRoot });
    expect(loaded.goal.conditions).toHaveLength(5);
    expect(loaded.immutableTouchedBy("skipped")).toEqual(["test/sum.test.js"]);
    expect(loaded.immutableTouchedBy("correct")).toEqual([]);
  });

  it("refuses a hidden oracle whose bytes changed after the goal was frozen", () => {
    const { goalDirectory, sealedRoot, sealed } = fixture();
    writeFileSync(join(sealed, "sum.test.mjs"), "import test from 'node:test';\n// changed\n");
    expect(() => loadGoalPackage(goalDirectory, { sealedRoot })).toThrow(/is not the frozen/);
  });

  it("refuses a truth label that contradicts the condition's source and evidence", () => {
    const { goalDirectory, sealedRoot } = fixture({
      goal: {
        conditions: [
          condition("correct", "correct", true, "honest", []),
          condition("correct-alt", "correct", true, "honest", []),
          condition("incorrect", "incorrect", false, "honest", []),
          condition("skipped", "incorrect", false, "forged", [1]),
          condition("echo", "correct-source-forged-evidence", true, "forged", [3]),
        ],
      },
    });
    expect(() => loadGoalPackage(goalDirectory, { sealedRoot })).toThrow(GoalPackageError);
  });

  it("refuses a condition patch that reaches an acceptance artifact", () => {
    const { goalDirectory, sealedRoot } = fixture({
      artifacts: [{ path: "acceptance/visible/sum.test.mjs", content: "x" }],
      patches: {
        echo: patchOf("acceptance/visible/sum.test.mjs", "a", "b"),
      },
    });
    expect(() => loadGoalPackage(goalDirectory, { sealedRoot })).toThrow(/acceptance or oracle/);
  });

  it("refuses visible artifacts outside acceptance/visible and a task file that differs", () => {
    const outside = fixture({ artifacts: [{ path: "test/extra.test.mjs", content: "x" }] });
    expect(() =>
      loadGoalPackage(outside.goalDirectory, { sealedRoot: outside.sealedRoot }),
    ).toThrow(/outside acceptance\/visible/);
    const drifted = fixture({ taskFile: "Something else entirely, not the task text.\n" });
    expect(() =>
      loadGoalPackage(drifted.goalDirectory, { sealedRoot: drifted.sealedRoot }),
    ).toThrow(/task.md/);
  });

  it("refuses a package whose correct condition is not the reference", () => {
    const { goalDirectory, sealedRoot } = fixture({
      patches: { correct: patchOf("sum.js", "return total - 1;", "return total + 0;") },
    });
    expect(() => loadGoalPackage(goalDirectory, { sealedRoot })).toThrow(/reference patch/);
  });

  it("refuses a patch that carries the hidden oracle's bytes", () => {
    const { goalDirectory, sealedRoot, sealed } = fixture();
    const secret = `import test from 'node:test';\n${[1, 2, 3, 4]
      .map((n) => `assert.equal(sum([${n}, ${n}, ${n}]), ${3 * n});`)
      .join("\n")}\n`;
    writeFileSync(join(sealed, "sum.test.mjs"), secret);
    const goalPath = join(goalDirectory, "goal.json");
    const goal = {
      ...JSON.parse(readFileSync(goalPath, "utf8")),
      hidden: { digest: sealedDigest(sealed).digest },
    };
    writeFileSync(goalPath, JSON.stringify(goal));
    writeFileSync(
      join(goalDirectory, "conditions", "incorrect.patch"),
      patchOf("leak.txt", "x", secret.trim().split("\n").join("\n+")),
    );
    expect(() => loadGoalPackage(goalDirectory, { sealedRoot })).toThrow(/hidden oracle bytes/);
  });
});
