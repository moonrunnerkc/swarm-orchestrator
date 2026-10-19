#!/usr/bin/env node
/**
 * Findings A and B through the product's own code, with real processes and no model.
 *
 * A: the planned-check runner against ordinary execution of the same program over the same
 *    project function, on string, number, boolean and object inputs: property existence
 *    (`"input" in Object(value)`), the prototype's own names, and properties the prototypes
 *    already had.
 * B: a project whose `isPositive` returns false for every input, a change check of -1, 0 and 1
 *    declared as the planner declares one, admitted through `admitPlannedChecks` with the real
 *    base verifier on a git checkout, then the same sealed check judged on the correct
 *    implementation by the same verifier.
 *
 *   node reproduce.mjs --out <file>
 *
 * Run from any directory; it imports the product's sources from this checkout, so the result
 * describes the implementation of the commit it is run at.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { admitPlannedChecks } from "../../../../src/cli-planned-checks.ts";
import { createSystemClock } from "../../../../src/cli-runtime-inputs.ts";
import { baseVerifier } from "../../../../src/cli-task-goal.ts";
import { freezeGoalContract } from "../../../../src/evidence/goal-contract.ts";
import { openEvidenceSession } from "../../../../src/evidence/session.ts";
import {
  plannedCheckRunner,
  plannedContract,
} from "../../../../src/workers/planned-check-program.ts";

const { values } = parseArgs({ options: { out: { type: "string" } } });
if (values.out === undefined) throw new Error("usage: reproduce.mjs --out <file>");
const scratch = mkdtempSync(join(tmpdir(), "swarm-reproduce-"));
const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();

// A. One project function that reports what the language environment says about its argument.
const projectA = join(scratch, "a");
mkdirSync(projectA);
writeFileSync(
  join(projectA, "probe.mjs"),
  `export function describe(value) {
  const boxed = Object(value);
  return {
    inputIn: "input" in boxed,
    expectedIn: "expected" in boxed,
    throwsIn: "throws" in boxed,
    prototypeNamesHoldInput: Object.getOwnPropertyNames(String.prototype).includes("input"),
    lengthIn: "length" in boxed,
    toUpperCaseIn: "toUpperCase" in boxed,
    toFixedIn: "toFixed" in boxed,
    readInputIsUndefined: boxed.input === undefined,
  };
}
`,
);
const programA = `import { describe } from "./probe.mjs";\nexport default function run(input) {\n  return describe(input);\n}\n`;
writeFileSync(join(projectA, "program.mjs"), programA);
const inputsA = ["hello", 7, true, { input: "x" }, { name: "o" }];
const throughRunner = spawnSync("node", ["--input-type=module", "-e", plannedCheckRunner], {
  cwd: projectA,
  input: JSON.stringify({ program: programA, inputs: inputsA }),
  encoding: "utf8",
});
const ordinary = spawnSync(
  "node",
  [
    "--input-type=module",
    "-e",
    `import run from "./program.mjs"; for (const input of ${JSON.stringify(inputsA)}) console.log(JSON.stringify(run(input)));`,
  ],
  { cwd: projectA, encoding: "utf8" },
);
const runnerResults = throughRunner.stdout
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line).result);
const ordinaryResults = ordinary.stdout
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const sorted = (value) =>
  JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
const findingA = {
  runnerExit: throughRunner.status,
  ordinaryExit: ordinary.status,
  rows: inputsA.map((input, index) => {
    const viaRunner = runnerResults[index] ?? null;
    const plain = ordinaryResults[index] ?? null;
    return {
      input,
      ordinary: plain,
      runner: viaRunner,
      differing:
        viaRunner === null || plain === null
          ? ["missing"]
          : Object.keys(plain).filter((key) => plain[key] !== viaRunner[key]),
    };
  }),
};
findingA.agree = findingA.rows.every(
  (row) => row.ordinary !== null && row.runner !== null && sorted(row.ordinary) === sorted(row.runner),
);

// B. A project whose defect is a constant answer, and the check that describes the task.
const projectB = join(scratch, "b");
mkdirSync(projectB);
writeFileSync(
  join(projectB, "package.json"),
  JSON.stringify({ name: "positive", version: "1.0.0", type: "module", scripts: { test: "node --test" } }),
);
writeFileSync(
  join(projectB, "sign.mjs"),
  "export function isPositive(n) {\n  return false;\n}\n",
);
git(projectB, "init", "-q");
git(projectB, "add", "-A");
git(projectB, "commit", "-qm", "base");
const broken = git(projectB, "rev-parse", "HEAD");
writeFileSync(join(projectB, "sign.mjs"), "export function isPositive(n) {\n  return n > 0;\n}\n");
git(projectB, "commit", "-qam", "correct implementation");
const correct = git(projectB, "rev-parse", "HEAD");
git(projectB, "checkout", "-q", broken);

const taskB = "Make isPositive return true for positive numbers and false otherwise.";
const caseRole = process.env.SWARM_REPRODUCE_CASE_ROLES === "1";
const declaration = {
  requirements: [
    { id: "positive", description: "true for positive numbers, false otherwise", quote: taskB },
  ],
  checks: [
    {
      id: "is-positive",
      requirement: "positive",
      purpose: "change",
      program: "import { isPositive } from './sign.mjs';\nexport default function (n) {\n  return isPositive(n);\n}\n",
      cases: [
        { input: -1, expected: false, ...(caseRole ? { changed: false } : {}) },
        { input: 0, expected: false, ...(caseRole ? { changed: false } : {}) },
        { input: 1, expected: true, ...(caseRole ? { changed: true } : {}) },
      ],
      why: "the task says positive numbers give true and everything else false",
    },
  ],
};
const clock = createSystemClock();
const signal = new AbortController().signal;
const session = (name) =>
  openEvidenceSession({ root: join(scratch, "sessions"), sessionId: name, clock });
const declared = plannedContract(taskB, declaration, undefined);
const planning = await session("planning");
const admission = await admitPlannedChecks({
  contract: declared,
  base: undefined,
  evidence: planning,
  verifyAtBase: (contract) =>
    baseVerifier({
      contract,
      workspace: projectB,
      baseCommit: broken,
      evidence: planning,
      clock,
      signal,
      isolation: null,
      install: false,
    })(contract),
});
const observedAt = async (commit, name) => {
  const chain = await session(name);
  const contract = freezeGoalContract({
    ...declared,
    requirements: [{ id: "judged", description: "the declared check", checks: ["is-positive"] }],
  }).contract;
  const result = await baseVerifier({
    contract,
    workspace: projectB,
    baseCommit: commit,
    evidence: chain,
    clock,
    signal,
    isolation: null,
    install: false,
  })(contract);
  // The base verifier answers with the goal acceptance itself.
  const finding = result.checkResults?.find((one) => one.id === "is-positive");
  const observation = chain.payloads().get(finding?.record ?? "")?.observation;
  return { status: finding?.status ?? null, stdout: observation?.stdout ?? null, exitCode: observation?.exitCode ?? null };
};
const findingB = {
  caseRolesDeclared: caseRole,
  decision: admission.decisions[0],
  admittedContract: admission.contract === null ? null : freezeGoalContract(admission.contract).digest,
  onBrokenBase: await observedAt(broken, "judged-broken"),
  onCorrectImplementation: await observedAt(correct, "judged-correct"),
};

const result = {
  schema: "swarm-checking-semantics-reproduction.v1",
  product: git(new URL("../../../../", import.meta.url).pathname, "rev-parse", "HEAD"),
  dirtySource:
    git(new URL("../../../../", import.meta.url).pathname, "status", "--porcelain", "--", "src").length > 0,
  node: process.version,
  findingA,
  findingB,
};
writeFileSync(values.out, `${JSON.stringify(result, null, 2)}\n`);
rmSync(scratch, { recursive: true, force: true });
console.log(
  JSON.stringify(
    {
      aAgree: findingA.agree,
      aDiffering: findingA.rows.map((row) => row.differing),
      bFinding: findingB.decision?.finding,
      bAdmitted: findingB.decision?.admitted,
      bBase: findingB.onBrokenBase.status,
      bCorrect: findingB.onCorrectImplementation.status,
    },
    null,
    1,
  ),
);
