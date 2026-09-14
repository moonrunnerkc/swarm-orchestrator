import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
