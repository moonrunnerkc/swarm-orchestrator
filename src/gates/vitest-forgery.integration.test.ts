import { execFileSync } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { capturedRegression } from "../evidence/verifier/status.mjs";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { verifyIndependently } from "./independent-verification.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";

/**
 * Both false passes reported against the published 1.0.5, with the real Vitest this repository
 * installs (the fixture commits a symlink to it, so no registry is reached): a configuration that
 * writes a passing report to the path in `process.argv` and exits before any test runs, and a
 * newly broken test behind a test the base already failed.
 */
let repository = "";
const clock = { now: () => 0, sleep: () => Promise.resolve() };
const commands = () => createNodeCommandRunner(clock, harnessChildEnvironment());

function git(args: readonly string[]) {
  return execFileSync("git", [...args], {
    cwd: repository,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  }).trim();
}

beforeEach(async () => {
  repository = await mkdtemp(join(tmpdir(), "swarm-vitest-forgery-"));
  git(["init", "-q"]);
  await writeFile(
    join(repository, "package.json"),
    '{"name":"w","private":true,"type":"module","scripts":{"test":"vitest run","lint":"node --check sum.js"}}\n',
  );
  await writeFile(join(repository, "sum.js"), "export const sum = (a, b) => a + b;\n");
  await writeFile(
    join(repository, "sum.test.js"),
    'import { expect, test } from "vitest";\nimport { sum } from "./sum.js";\ntest("adds", () => expect(sum(1, 2)).toBe(3));\n',
  );
  await symlink(resolve("node_modules"), join(repository, "node_modules"));
  git(["add", "-A"]);
  git(["commit", "-qm", "base"]);
});

afterEach(async () => {
  await rm(repository, { recursive: true, force: true });
});

const breakSum = [
  "diff --git a/sum.js b/sum.js",
  "--- a/sum.js",
  "+++ b/sum.js",
  "@@ -1 +1 @@",
  "-export const sum = (a, b) => a + b;",
  "+export const sum = (a, b) => a - b;",
];

it("does not pass a Vitest configuration that forges the report and exits before any test runs", async () => {
  const forgery = [
    'import { writeFileSync } from "node:fs";',
    'const flag = process.argv.find((arg) => arg.startsWith("--outputFile="));',
    "if (flag) {",
    '  writeFileSync(flag.slice("--outputFile=".length), JSON.stringify({ numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0, testResults: [{ name: process.cwd() + "/sum.test.js", assertionResults: [{ fullName: "adds", status: "passed" }] }] }));',
    "  process.exit(0);",
    "}",
    "export default {};",
  ];
  const patch = [
    ...breakSum,
    "diff --git a/vitest.config.js b/vitest.config.js",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/vitest.config.js",
    `@@ -0,0 +1,${forgery.length} @@`,
    ...forgery.map((line) => `+${line}`),
    "",
  ].join("\n");

  const result = await verifyIndependently({
    repositoryRoot: repository,
    baseCommit: git(["rev-parse", "HEAD"]),
    patch,
    commands: commands(),
    clock,
  });

  const tests = result.checks.find((check) => check.id === "tests");
  expect(tests?.configurationStatus).toBe("failed");
  expect(tests?.regressedUnderBaseConfiguration).toEqual(["sum.test.js:adds"]);
  expect(tests?.status).toBe("failed");
  expect(result.regression).toBe("fail");
  expect(capturedRegression(result.checks)).toBe("fail");
}, 120_000);

it("calls a test the patch broke a regression although the base already failed another", async () => {
  await writeFile(
    join(repository, "known.test.js"),
    'import { expect, test } from "vitest";\ntest("known broken", () => expect(1).toBe(2));\n',
  );
  git(["add", "-A"]);
  git(["commit", "-qm", "a base with a known failure"]);

  const result = await verifyIndependently({
    repositoryRoot: repository,
    baseCommit: git(["rev-parse", "HEAD"]),
    patch: [...breakSum, ""].join("\n"),
    commands: commands(),
    clock,
  });

  const tests = result.checks.find((check) => check.id === "tests");
  expect(result.checks.find((check) => check.id === "lint")?.status).toBe("passed");
  expect(tests?.attribution).toBe("new");
  expect(tests?.newFailures).toEqual(["sum.test.js:adds"]);
  expect(result.regression).toBe("fail");
  expect(capturedRegression(result.checks)).toBe("fail");
}, 120_000);
