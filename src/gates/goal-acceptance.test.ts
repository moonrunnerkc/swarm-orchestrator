import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { createSystemClock } from "../cli-runtime-inputs.ts";
import { declareGoalContract, type GoalContract } from "../evidence/goal-contract.ts";
import { openEvidenceSession } from "../evidence/session.ts";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { verifyIndependently } from "./independent-verification.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";

const command = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "swarm-goal-verifier-"));
  roots.push(root);
  const repository = join(root, "repo");
  await mkdir(repository);
  await writeFile(
    join(repository, "package.json"),
    JSON.stringify({ type: "module", scripts: { test: "node --test" } }),
  );
  await writeFile(
    join(repository, "base.test.js"),
    "import {test} from 'node:test'; import assert from 'node:assert/strict'; test('base', () => assert.equal(2, 2));\n",
  );
  await command("git", ["init", "-q", repository]);
  const git = (...args: string[]) => command("git", ["-C", repository, ...args]);
  await git("add", ".");
  await git(
    "-c",
    "user.name=fixture",
    "-c",
    "user.email=fixture@example.com",
    "commit",
    "-qm",
    "base",
  );
  const baseCommit = (await git("rev-parse", "HEAD")).stdout.trim();
  await writeFile(join(repository, "feature.js"), "export const feature = 1;\n");
  await git("add", ".");
  const tree = (await git("write-tree")).stdout.trim();
  const patch = (await git("diff", "--cached", "--binary")).stdout;
  const clock = createSystemClock();
  const evidence = await openEvidenceSession({
    root: join(root, "sessions"),
    sessionId: "verify",
    clock,
  });
  return {
    repository,
    root,
    baseCommit,
    tree,
    patch,
    clock,
    evidence,
    commands: createNodeCommandRunner(clock, harnessChildEnvironment()),
  };
}
const goal: GoalContract = {
  version: 1,
  goal: "feature",
  selection: "stable",
  immutablePaths: [],
  requirements: [{ id: "feature", description: "one feature", checks: ["feature"] }],
  checks: [
    {
      id: "feature",
      author: "user",
      exposure: "withheld",
      command: "node acceptance.mjs",
      artifacts: [
        {
          path: "acceptance.mjs",
          content:
            "import assert from 'node:assert/strict'; import {feature} from './feature.js'; assert.equal(feature, 1);\n",
        },
      ],
    },
  ],
};
it("refuses producer changes to acceptance artifacts before invoking a check", async () => {
  const setup = await fixture();
  await writeFile(join(setup.repository, "acceptance.mjs"), "process.exit(0);\n");
  await command("git", ["-C", setup.repository, "add", "."]);
  const patch = (await command("git", ["-C", setup.repository, "diff", "--cached", "--binary"]))
    .stdout;
  await declareGoalContract(setup.evidence, goal);
  const observed = await verifyIndependently({
    repositoryRoot: setup.repository,
    baseCommit: setup.baseCommit,
    patch,
    clock: setup.clock,
    commands: setup.commands,
    goal: { contract: goal, evidence: setup.evidence, tree: setup.tree },
  });
  expect(observed.applied).toBe(false);
  expect(observed.refusal).toContain("acceptance.mjs");
  expect(setup.evidence.records().some((entry) => entry.type === "goal-check")).toBe(false);
});
it("rejects a check that mutates the candidate and leaves uncovered requirements unjudged", async () => {
  const setup = await fixture();
  const check = goal.checks[0];
  if (check === undefined) throw new Error("fixture requires a check");
  const contract: GoalContract = {
    ...goal,
    requirements: [
      ...goal.requirements,
      { id: "usability", description: "human judgement", checks: [] },
    ],
    checks: [
      {
        ...check,
        artifacts: [
          {
            path: "acceptance.mjs",
            content:
              "import {writeFileSync} from 'node:fs'; writeFileSync('feature.js', 'export const feature = 99;\\n');\n",
          },
        ],
      },
    ],
  };
  await declareGoalContract(setup.evidence, contract);
  const observed = await verifyIndependently({
    repositoryRoot: setup.repository,
    baseCommit: setup.baseCommit,
    patch: setup.patch,
    clock: setup.clock,
    commands: setup.commands,
    goal: { contract, evidence: setup.evidence, tree: setup.tree },
  });
  expect(observed.goalAcceptance?.obligations.map((entry) => entry.status)).toEqual([
    "rejected",
    "unjudged",
  ]);
  expect(observed.verified).toBe(false);
});

it("records refusal when a check deletes its own pinned artifact", async () => {
  const setup = await fixture();
  const contract: GoalContract = {
    ...goal,
    checks: [
      {
        id: "feature",
        author: "user",
        exposure: "withheld",
        command: "node acceptance.mjs",
        artifacts: [
          {
            path: "acceptance.mjs",
            content: "import {unlinkSync} from 'node:fs'; unlinkSync(new URL(import.meta.url));\n",
          },
        ],
      },
    ],
  };
  await declareGoalContract(setup.evidence, contract);
  const observed = await verifyIndependently({
    ...setup,
    repositoryRoot: setup.repository,
    goal: { contract, evidence: setup.evidence, tree: setup.tree },
  });
  expect(observed.verified).toBe(false);
  expect(observed.goalAcceptance?.obligations[0]?.status).toBe("rejected");
  expect(setup.evidence.records().some((record) => record.type === "goal-check")).toBe(true);
});
it("executes ordinary goal acceptance for an empty patch instead of failing git apply", async () => {
  const setup = await fixture();
  const tree = (
    await command("git", ["-C", setup.repository, "rev-parse", `${setup.baseCommit}^{tree}`])
  ).stdout.trim();
  const contract: GoalContract = {
    ...goal,
    checks: [
      {
        id: "feature",
        author: "user",
        exposure: "withheld",
        command: "node acceptance.mjs",
        artifacts: [
          {
            path: "acceptance.mjs",
            content:
              "import assert from 'node:assert/strict'; import {existsSync} from 'node:fs'; assert.ok(existsSync('package.json'));\n",
          },
        ],
      },
    ],
  };
  await declareGoalContract(setup.evidence, contract);
  const observed = await verifyIndependently({
    ...setup,
    repositoryRoot: setup.repository,
    patch: "",
    goal: { contract, evidence: setup.evidence, tree },
  });
  expect(observed.applied).toBe(true);
  expect(observed.goalAcceptance?.accepted).toBe(true);
});

it("runs each goal check without ignored artifacts left by a preceding check", async () => {
  const setup = await fixture();
  await writeFile(join(setup.repository, ".gitignore"), "generated/\n");
  const existingTest = await readFile(join(setup.repository, "base.test.js"), "utf8");
  await writeFile(
    join(setup.repository, "base.test.js"),
    existingTest +
      "import {mkdirSync, writeFileSync} from 'node:fs'; mkdirSync('generated', {recursive:true}); writeFileSync('generated/setup.json', 'baseline');\n",
  );
  await command("git", ["-C", setup.repository, "add", "."]);
  const patch = (await command("git", ["-C", setup.repository, "diff", "--cached", "--binary"]))
    .stdout;
  const tree = (await command("git", ["-C", setup.repository, "write-tree"])).stdout.trim();
  const contract: GoalContract = {
    ...goal,
    requirements: [
      { id: "feature", description: "independent observations", checks: ["build", "fresh"] },
    ],
    checks: [
      {
        id: "build",
        author: "user",
        exposure: "withheld",
        command: "node build.mjs",
        artifacts: [
          {
            path: "build.mjs",
            content:
              "import {mkdirSync, writeFileSync} from 'node:fs'; mkdirSync('generated', {recursive:true}); writeFileSync('generated/feature.json', 'true'); writeFileSync('generated/setup.json', 'changed');\n",
          },
        ],
      },
      {
        id: "fresh",
        author: "user",
        exposure: "withheld",
        command: "node fresh.mjs",
        artifacts: [
          {
            path: "fresh.mjs",
            content:
              "import assert from 'node:assert/strict'; import {existsSync, readFileSync} from 'node:fs'; assert.equal(existsSync('generated/feature.json'), false); assert.equal(readFileSync('generated/setup.json', 'utf8'), 'baseline');\n",
          },
        ],
      },
    ],
  };
  await declareGoalContract(setup.evidence, contract);
  const observed = await verifyIndependently({
    ...setup,
    repositoryRoot: setup.repository,
    patch,
    goal: { contract, evidence: setup.evidence, tree },
  });
  expect(observed.goalAcceptance?.accepted).toBe(true);
});
it("rejects a check that stages its source mutation to hide it from git diff", async () => {
  const setup = await fixture();
  const contract: GoalContract = {
    ...goal,
    checks: [
      {
        id: "feature",
        author: "user",
        exposure: "withheld",
        command: "node staged.mjs",
        artifacts: [
          {
            path: "staged.mjs",
            content:
              "import {writeFileSync} from 'node:fs'; import {execFileSync} from 'node:child_process'; writeFileSync('feature.js', 'export const feature = 99;\\n'); execFileSync('git', ['add', 'feature.js']);\n",
          },
        ],
      },
    ],
  };
  await declareGoalContract(setup.evidence, contract);
  const observed = await verifyIndependently({
    ...setup,
    repositoryRoot: setup.repository,
    goal: { contract, evidence: setup.evidence, tree: setup.tree },
  });
  expect(observed.goalAcceptance?.accepted).toBe(false);
});

it("refuses a candidate link as an acceptance artifact parent without writing outside the checkout", async () => {
  const setup = await fixture();
  const outside = join(setup.root, "outside");
  await mkdir(outside);
  await symlink(outside, join(setup.repository, "checks"), "dir");
  await command("git", ["-C", setup.repository, "add", "."]);
  const patch = (await command("git", ["-C", setup.repository, "diff", "--cached", "--binary"]))
    .stdout;
  const tree = (await command("git", ["-C", setup.repository, "write-tree"])).stdout.trim();
  const contract: GoalContract = {
    ...goal,
    checks: [
      {
        id: "feature",
        author: "user",
        exposure: "withheld",
        command: "node checks/accept.mjs",
        artifacts: [{ path: "checks/accept.mjs", content: "process.exit(0);\n" }],
      },
    ],
  };
  await declareGoalContract(setup.evidence, contract);
  await expect(
    verifyIndependently({
      ...setup,
      repositoryRoot: setup.repository,
      patch,
      goal: { contract, evidence: setup.evidence, tree },
    }),
  ).rejects.toThrow("acceptance artifact refused");
  await expect(readFile(join(outside, "accept.mjs"))).rejects.toMatchObject({ code: "ENOENT" });
});
it("cleans a replaced artifact directory without following its link to another file", async () => {
  const setup = await fixture();
  const outside = join(setup.root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "accept.mjs"), "user file");
  const contract: GoalContract = {
    ...goal,
    checks: [
      {
        id: "feature",
        author: "user",
        exposure: "withheld",
        command: "node checks/accept.mjs",
        artifacts: [
          {
            path: "checks/accept.mjs",
            content: `import {rmSync, symlinkSync} from 'node:fs'; rmSync('checks', {recursive:true}); symlinkSync(${JSON.stringify(outside)}, 'checks', 'dir');\n`,
          },
        ],
      },
    ],
  };
  await declareGoalContract(setup.evidence, contract);
  const observed = await verifyIndependently({
    ...setup,
    repositoryRoot: setup.repository,
    goal: { contract, evidence: setup.evidence, tree: setup.tree },
  });
  expect(observed.goalAcceptance?.accepted).toBe(false);
  expect(await readFile(join(outside, "accept.mjs"), "utf8")).toBe("user file");
});
