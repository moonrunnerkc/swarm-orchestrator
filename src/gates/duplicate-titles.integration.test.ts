import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { decideResult } from "../action/verify.ts";
import { capturedRegression } from "../evidence/verifier/status.mjs";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { verifyIndependently } from "./independent-verification.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";

/**
 * SV-24, reproduced as reported against the published 1.0.7 with the real node test runner: two
 * files each declare `test("works")`, the first already failing. A patch that breaks the second
 * made two failures under one TAP identity (`0:works`), and the failure the base already had
 * vouched for both: inherited, regression pass, and the Action's `regression-only`. A comment-only
 * patch over the same unchanged failure must still read as inherited.
 */
let repository = "";
const clock = { now: () => 0, sleep: () => Promise.resolve() };

function git(args: readonly string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd: repository,
    encoding: "utf8",
  }).trim();
}

beforeEach(async () => {
  repository = await mkdtemp(join(tmpdir(), "swarm-duplicate-titles-"));
  git(["init", "-q"]);
  await writeFile(
    join(repository, "package.json"),
    '{"name":"w","private":true,"type":"module","scripts":{"test":"node --test","lint":"node --check calc.mjs"}}\n',
  );
  await writeFile(join(repository, "calc.mjs"), "export const double = (n) => n * 2;\n");
  await writeFile(
    join(repository, "a.test.mjs"),
    'import test from "node:test";\nimport assert from "node:assert/strict";\ntest("works", () => { assert.equal(1, 2); });\n',
  );
  await writeFile(
    join(repository, "b.test.mjs"),
    'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { double } from "./calc.mjs";\ntest("works", () => { assert.equal(double(2), 4); });\n',
  );
  git(["add", "-A"]);
  git(["commit", "-qm", "base"]);
});

afterEach(async () => {
  await rm(repository, { recursive: true, force: true });
});

function patchFor(line: string): string {
  return [
    "diff --git a/calc.mjs b/calc.mjs",
    "--- a/calc.mjs",
    "+++ b/calc.mjs",
    "@@ -1 +1 @@",
    "-export const double = (n) => n * 2;",
    `+${line}`,
    "",
  ].join("\n");
}

async function verify(line: string) {
  return verifyIndependently({
    repositoryRoot: repository,
    baseCommit: git(["rev-parse", "HEAD"]),
    patch: patchFor(line),
    commands: createNodeCommandRunner(clock, harnessChildEnvironment()),
    clock,
  });
}

it("calls the second same-titled failure new, in the verdict, the Action and the offline reader", async () => {
  const result = await verify("export const double = (n) => n * 3;");
  const tests = result.checks.find((check) => check.id === "tests");
  expect(tests?.status).toBe("failed");
  expect(tests?.attribution).toBe("new");
  expect(tests?.inheritedFromBase).toBe(false);
  expect(tests?.attributionRule).toBe("failure-identity-v3");
  expect(tests?.newFailures).toEqual(["b.test.mjs:4:1 › 0:works"]);
  expect(result.regression).toBe("fail");
  expect(capturedRegression(result.checks)).toBe("fail");
  expect(decideResult(result as never)).toBe("not-verified");
}, 120_000);

it("still reads a comment-only patch over the unchanged failure as inherited, with the failure kept", async () => {
  const result = await verify("export const double = (n) => n * 2; // doubles");
  const tests = result.checks.find((check) => check.id === "tests");
  expect(tests?.status).toBe("failed");
  expect(tests?.attribution).toBe("inherited");
  expect(tests?.inheritedFromBase).toBe(true);
  expect(result.regression).toBe("pass");
  expect(capturedRegression(result.checks)).toBe("pass");
  expect(decideResult(result as never)).toBe("regression-only");
}, 120_000);

it("does not inherit a failure whose cause the patch changed", async () => {
  await writeFile(
    join(repository, "a.test.mjs"),
    'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { double } from "./calc.mjs";\ntest("works", () => { assert.equal(double(2), 5); });\n',
  );
  git(["add", "-A"]);
  git(["commit", "-qm", "the known failure now calls the code"]);
  const result = await verify("export const double = (n) => n * 2 + 0.5;");
  const tests = result.checks.find((check) => check.id === "tests");
  // a.test.mjs fails either way, but with another actual value; b.test.mjs is newly failing.
  expect(tests?.attribution).toBe("new");
  expect(tests?.newFailures).toEqual(["b.test.mjs:4:1 › 0:works"]);

  await writeFile(
    join(repository, "b.test.mjs"),
    'import test from "node:test";\ntest("works", () => {});\n',
  );
  git(["add", "-A"]);
  git(["commit", "-qm", "b no longer calls the code"]);
  const changed = await verify("export const double = (n) => n * 2 + 0.5;");
  const only = changed.checks.find((check) => check.id === "tests");
  expect(only?.attribution).toBe("unattributed");
  expect(changed.regression).toBe("unmeasured");
  expect(capturedRegression(changed.checks)).toBe("unmeasured");
  expect(decideResult(changed as never)).toBe("incomplete");
}, 180_000);
