import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { verifyIndependently } from "./independent-verification.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";

let repository = "";

const clock = { now: () => 0, sleep: () => Promise.resolve() };

function git(args: readonly string[], cwd: string) {
  execFileSync("git", [...args], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
}

beforeEach(async () => {
  repository = await mkdtemp(join(tmpdir(), "swarm-independent-"));
  git(["init", "-q"], repository);
  await writeFile(
    join(repository, "package.json"),
    '{"name":"w","version":"1.0.0","type":"module","scripts":{"test":"node --test"}}\n',
  );
  await writeFile(join(repository, "clamp.mjs"), "export const clamp = (v) => v;\n");
  await writeFile(
    join(repository, "clamp.test.mjs"),
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { clamp } from './clamp.mjs';\ntest('identity', () => assert.equal(clamp(3), 3));\n",
  );
  git(["add", "-A"], repository);
  git(["commit", "-qm", "base"], repository);
});

afterEach(async () => {
  await rm(repository, { recursive: true, force: true });
});

function baseCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();
}

const commands = () => createNodeCommandRunner(clock, harnessChildEnvironment());

describe("verification that does not trust the tree it is verifying", () => {
  it("applies the patch to a fresh checkout of the base and runs the checks there", async () => {
    const patch = [
      "diff --git a/clamp.mjs b/clamp.mjs",
      "--- a/clamp.mjs",
      "+++ b/clamp.mjs",
      "@@ -1 +1 @@",
      "-export const clamp = (v) => v;",
      "+export const clamp = (v) => (v < 0 ? 0 : v);",
      "",
    ].join("\n");

    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch,
      commands: commands(),
      clock,
    });

    expect(result.applied).toBe(true);
    expect(result.checks.find((check) => check.id === "tests")?.status).toBe("passed");
    // No regression, and nothing here says the task was done. `verified` requires both, which
    // is what stops a suite written before the feature existed vouching for the feature.
    expect(result.regression).toBe("pass");
    expect(result.task).toBe("unjudged");
    expect(result.verified).toBe(false);
  }, 180_000);

  it("does not read a report the worker wrote, because the worker is what is being checked", async () => {
    // A tree that ships its own passing report and a suite that fails. Trusting the artifact
    // would call this verified; running the checks in a fresh checkout does not.
    await writeFile(join(repository, "results.tap"), "TAP version 13\n1..1\nok 1 - everything\n");
    const patch = [
      "diff --git a/clamp.mjs b/clamp.mjs",
      "--- a/clamp.mjs",
      "+++ b/clamp.mjs",
      "@@ -1 +1 @@",
      "-export const clamp = (v) => v;",
      "+export const clamp = () => { throw new Error('broken'); };",
      "",
    ].join("\n");

    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch,
      commands: commands(),
      clock,
    });

    expect(result.applied).toBe(true);
    expect(result.checks.find((check) => check.id === "tests")?.status).toBe("failed");
    expect(result.regression).toBe("fail");
    expect(result.verified).toBe(false);
  }, 180_000);

  it("refuses a patch that touches a path the run declared immutable", async () => {
    const patch = [
      "diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/.github/workflows/ci.yml",
      "@@ -0,0 +1 @@",
      "+on: push",
      "",
    ].join("\n");

    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch,
      immutablePaths: [".github/**"],
      commands: commands(),
      clock,
    });

    expect(result.verified).toBe(false);
    expect(result.refusal).toMatch(/immutable/i);
  }, 120_000);

  it("says a patch that will not apply did not apply, rather than passing on an unchanged tree", async () => {
    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch: "this is not a patch\n",
      commands: commands(),
      clock,
    });

    expect(result.applied).toBe(false);
    expect(result.verified).toBe(false);
  }, 120_000);

  it("leaves nothing behind, whatever happened", async () => {
    const before = await readFile(join(repository, "clamp.mjs"), "utf8");

    await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch: "this is not a patch\n",
      commands: commands(),
      clock,
    });

    expect(await readFile(join(repository, "clamp.mjs"), "utf8")).toBe(before);
  }, 120_000);
});

describe("verifying a repository whose tests need its dependencies", () => {
  /**
   * A fresh checkout has no node_modules. A real project's runner lives there, so the tests gate
   * finds no command, reports that it measured nothing, and the patch comes back unverified with
   * nothing failed. Eighteen real-repository patches re-scored that way: every one refused, and
   * eleven of them passed a hidden acceptance test written before any run.
   */
  it("says the checks measured nothing rather than reporting a failure", async () => {
    // A project whose test script names a runner that is not installed.
    await writeFile(
      join(repository, "package.json"),
      // A runner that is genuinely absent. `vitest` is not: this suite runs under vitest, which
      // puts its own node_modules/.bin on PATH, so a child resolves it and exits 1 on "no test
      // files" rather than 127 on "not installed".
      '{"name":"w","version":"1.0.0","type":"module","scripts":{"test":"definitely-not-a-runner run"}}\n',
    );
    git(["add", "-A"], repository);
    git(["commit", "-qm", "needs a runner"], repository);

    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch: [
        "diff --git a/clamp.mjs b/clamp.mjs",
        "--- a/clamp.mjs",
        "+++ b/clamp.mjs",
        "@@ -1 +1 @@",
        "-export const clamp = (v) => v;",
        "+export const clamp = (v) => (v < 0 ? 0 : v);",
        "",
      ].join("\n"),
      commands: commands(),
      clock,
    });

    expect(result.applied).toBe(true);
    expect(result.verified).toBe(false);
    // The distinction the whole project turns on: nothing measured is not the same as measured
    // and found wanting, and the reader has to be able to tell which happened.
    expect(result.unmeasured).toBe(true);
    expect(result.checks.every((check) => check.status !== "failed")).toBe(true);
  }, 180_000);

  it("names the install that would make the checks runnable", async () => {
    await writeFile(
      join(repository, "package.json"),
      // A runner that is genuinely absent. `vitest` is not: this suite runs under vitest, which
      // puts its own node_modules/.bin on PATH, so a child resolves it and exits 1 on "no test
      // files" rather than 127 on "not installed".
      '{"name":"w","version":"1.0.0","type":"module","scripts":{"test":"definitely-not-a-runner run"}}\n',
    );
    git(["add", "-A"], repository);
    git(["commit", "-qm", "needs a runner"], repository);

    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch:
        "diff --git a/clamp.mjs b/clamp.mjs\n--- a/clamp.mjs\n+++ b/clamp.mjs\n@@ -1 +1 @@\n-export const clamp = (v) => v;\n+export const clamp = (v) => v;\n",
      commands: commands(),
      clock,
    });

    expect(result.advice).toMatch(/--install/);
  }, 180_000);

  it("installs from the lockfile when asked, so the checks can run", async () => {
    // node --test needs nothing installed, so this shows the phase runs and reports rather than
    // that a particular package manager works: installing is a decision, and it is recorded.
    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch: [
        "diff --git a/clamp.mjs b/clamp.mjs",
        "--- a/clamp.mjs",
        "+++ b/clamp.mjs",
        "@@ -1 +1 @@",
        "-export const clamp = (v) => v;",
        "+export const clamp = (v) => (v < 0 ? 0 : v);",
        "",
      ].join("\n"),
      installDependencies: true,
      commands: commands(),
      clock,
    });

    expect(result.install).not.toBeNull();
    expect(result.install?.attempted).toBe(true);
  }, 300_000);
});

/**
 * Re-scoring eighteen real-repository patches with dependencies installed produced four false
 * greens: `swarm ci` said verified over changes a hidden acceptance test refused. The cause is
 * not a bug in a check, it is what the checks establish. A repository's own suite tests the
 * behaviour it already had; the task adds behaviour it did not. A patch that adds the feature
 * badly, or not at all, still passes that suite.
 *
 * So running the suite establishes that nothing broke. It does not establish that the task was
 * done, and reporting the first as if it were the second is the false green this closes.
 */
describe("what passing a repository's own suite establishes", () => {
  const workingPatch = [
    "diff --git a/clamp.mjs b/clamp.mjs",
    "--- a/clamp.mjs",
    "+++ b/clamp.mjs",
    "@@ -1 +1 @@",
    "-export const clamp = (v) => v;",
    "+export const clamp = (v) => (v < 0 ? 0 : v);",
    "",
  ].join("\n");

  it("reports no regression and an unjudged task where no oracle was given", async () => {
    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch: workingPatch,
      commands: commands(),
      clock,
    });

    expect(result.regression).toBe("pass");
    expect(result.task).toBe("unjudged");
    // Not verified: nothing here says the task was done, and saying so would be the false green.
    expect(result.verified).toBe(false);
  }, 180_000);

  it("accepts the task where an oracle says it was done", async () => {
    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch: workingPatch,
      taskOracle: {
        command: "node -e \"import('./clamp.mjs').then(m=>process.exit(m.clamp(-1)===0?0:1))\"",
      },
      commands: commands(),
      clock,
    });

    expect(result.regression).toBe("pass");
    expect(result.task).toBe("accepted");
    expect(result.verified).toBe(true);
  }, 180_000);

  it("rejects the task where the oracle refuses it, even with the suite passing", async () => {
    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      // A patch that changes nothing meaningful: the suite still passes, the task is not done.
      patch:
        "diff --git a/clamp.mjs b/clamp.mjs\n--- a/clamp.mjs\n+++ b/clamp.mjs\n@@ -1 +1 @@\n-export const clamp = (v) => v;\n+export const clamp = (v) => v; // touched\n",
      taskOracle: {
        command: "node -e \"import('./clamp.mjs').then(m=>process.exit(m.clamp(-1)===0?0:1))\"",
      },
      commands: commands(),
      clock,
    });

    expect(result.regression).toBe("pass");
    expect(result.task).toBe("rejected");
    expect(result.verified).toBe(false);
  }, 180_000);
});

describe("a failure the base already had", () => {
  /**
   * A check that fails with the patch and fails identically without it was not caused by the
   * patch. Charging it to the patch is the collapse of *unmeasured* into *failed* that this
   * project exists to refuse, and it is not hypothetical: verifying a koa patch reported
   * `regression: fail` on two tests that fail at the base too, because the install runs with
   * --ignore-scripts and koa's `prepare` builds the ESM wrapper its tests import.
   */
  it("names a failure the base already had as inherited rather than as a regression", async () => {
    await writeFile(
      join(repository, "broken.test.mjs"),
      "import { test } from 'node:test';\ntest('already broken', () => { throw new Error('base'); });\n",
    );
    git(["add", "-A"], repository);
    git(["commit", "-qm", "a base that already fails"], repository);

    const patch = [
      "diff --git a/clamp.mjs b/clamp.mjs",
      "--- a/clamp.mjs",
      "+++ b/clamp.mjs",
      "@@ -1 +1 @@",
      "-export const clamp = (v) => v;",
      "+export const clamp = (v) => (v < 0 ? 0 : v);",
      "",
    ].join("\n");

    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch,
      commands: commands(),
      clock,
    });

    const tests = result.checks.find((check) => check.id === "tests");
    expect(tests?.status).toBe("failed");
    expect(tests?.inheritedFromBase).toBe(true);
    // The patch broke nothing, so the verification must not say it did.
    expect(result.regression).not.toBe("fail");
  });

  it("still calls a failure the patch caused a regression", async () => {
    const patch = [
      "diff --git a/clamp.mjs b/clamp.mjs",
      "--- a/clamp.mjs",
      "+++ b/clamp.mjs",
      "@@ -1 +1 @@",
      "-export const clamp = (v) => v;",
      "+export const clamp = (v) => 999;",
      "",
    ].join("\n");

    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch,
      commands: commands(),
      clock,
    });

    const tests = result.checks.find((check) => check.id === "tests");
    expect(tests?.status).toBe("failed");
    expect(tests?.inheritedFromBase).toBe(false);
    expect(result.regression).toBe("fail");
  });

  /**
   * Attribution reverts the patch to measure the base, so anything reading the tree afterwards
   * reads the base. The oracle must run before that or it judges the source the patch replaced,
   * rejects every patch, and reports it as the task not being done.
   */
  it("judges the task against the patched tree even when a failing check triggers attribution", async () => {
    await writeFile(
      join(repository, "broken.test.mjs"),
      "import { test } from 'node:test';\ntest('already broken', () => { throw new Error('base'); });\n",
    );
    git(["add", "-A"], repository);
    git(["commit", "-qm", "a base that already fails"], repository);

    const patch = [
      "diff --git a/clamp.mjs b/clamp.mjs",
      "--- a/clamp.mjs",
      "+++ b/clamp.mjs",
      "@@ -1 +1 @@",
      "-export const clamp = (v) => v;",
      "+export const clamp = (v) => (v < 0 ? 0 : v);",
      "",
    ].join("\n");

    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch,
      commands: commands(),
      clock,
      // Passes only where the patch is applied, so it fails if the tree was reverted first.
      taskOracle: { command: "grep -q 'v < 0' clamp.mjs" },
    });

    expect(result.checks.find((check) => check.id === "tests")?.inheritedFromBase).toBe(true);
    expect(result.task).toBe("accepted");
  });
});

describe("an oracle that cannot fail", () => {
  /**
   * `swarm ci` runs the oracle it is handed and reports what it said, never asking whether it was
   * capable of saying anything else. An oracle that accepts the unpatched base accepts a patch
   * that changes nothing, so `task: accepted` establishes nothing about the work.
   *
   * Four of fifteen certified tasks in the mined corpus had exactly this, and one of them was
   * published as a false green before it was noticed. The same reasoning already runs on gates,
   * where a check that passes over a bond it saw is recorded vacuous.
   */
  it("does not report a task accepted when the oracle accepts the base too", async () => {
    const patch = [
      "diff --git a/clamp.mjs b/clamp.mjs",
      "--- a/clamp.mjs",
      "+++ b/clamp.mjs",
      "@@ -1 +1 @@",
      "-export const clamp = (v) => v;",
      "+export const clamp = (v) => (v < 0 ? 0 : v);",
      "",
    ].join("\n");

    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch,
      commands: commands(),
      clock,
      // True before the patch and after it, so it distinguishes nothing.
      taskOracle: { command: "test -f clamp.mjs" },
    });

    expect(result.task).toBe("vacuous");
    expect(result.verified).toBe(false);
    expect(result.advice).toContain("accepts the base");
  });

  it("still accepts an oracle that the base fails", async () => {
    const patch = [
      "diff --git a/clamp.mjs b/clamp.mjs",
      "--- a/clamp.mjs",
      "+++ b/clamp.mjs",
      "@@ -1 +1 @@",
      "-export const clamp = (v) => v;",
      "+export const clamp = (v) => (v < 0 ? 0 : v);",
      "",
    ].join("\n");

    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch,
      commands: commands(),
      clock,
      taskOracle: { command: "grep -q 'v < 0' clamp.mjs" },
    });

    expect(result.task).toBe("accepted");
    expect(result.verified).toBe(true);
  });
});

describe("an oracle that only ran part of the change", () => {
  /**
   * koa#1946 was certified by an oracle that never executed the branch a held-back oracle then
   * refused: lines 270 to 273 of the file it changed were never reached. An oracle is evidence
   * only about the code it ran, so certifying on one that skipped part of the change is the tool
   * asserting more than it measured.
   *
   * Measurable only where the harness can build the invocation itself, per invariant 7: a coverage
   * number the workspace could author is not a measurement of the workspace. Where it cannot,
   * reach is `unmeasured` and says so rather than passing.
   */
  it("reports reach as unmeasured when it cannot build the oracle invocation itself", async () => {
    const patch = [
      "diff --git a/clamp.mjs b/clamp.mjs",
      "--- a/clamp.mjs",
      "+++ b/clamp.mjs",
      "@@ -1 +1 @@",
      "-export const clamp = (v) => v;",
      "+export const clamp = (v) => (v < 0 ? 0 : v);",
      "",
    ].join("\n");

    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch,
      commands: commands(),
      clock,
      // A shell string the harness cannot re-express as a vouched argv, so nothing can be
      // instrumented and the honest answer is that reach was not measured.
      taskOracle: { command: "grep -q 'v < 0' clamp.mjs" },
    });

    expect(result.task).toBe("accepted");
    expect(result.oracleReach).toBe("unmeasured");
    // Not measured must not block: it is an absence of evidence, not evidence of a gap.
    expect(result.verified).toBe(true);
  });
});

describe("an oracle that never ran the lines the patch added", () => {
  /**
   * The koa#1946 shape, reduced. The patch does two things: it coerces the value, which the
   * oracle's own test detects, and it adds a floor branch, which that test never takes. So the
   * oracle refuses the base (not vacuous) and passes the patch while judging only half of it,
   * and a held-back test of the floor would have refused. Certifying here is the tool asserting
   * more than it measured, which is why `unreached` blocks where `unmeasured` does not.
   */
  const branchingPatch = [
    "diff --git a/clamp.mjs b/clamp.mjs",
    "--- a/clamp.mjs",
    "+++ b/clamp.mjs",
    "@@ -1 +1,6 @@",
    "-export const clamp = (v) => v;",
    "+export const clamp = (v, low = 0) => {",
    "+  if (v < low) {",
    "+    return low;",
    "+  }",
    "+  return Number(v);",
    "+};",
    "",
  ].join("\n");

  /** Copied in at judging time, never present in the tree the patch was written against. */
  async function oracleThatSkipsTheBranch() {
    const stored = join(repository, "..", `oracle-${Date.now()}.mjs`);
    await writeFile(
      stored,
      "import { test } from 'node:test';\n" +
        "import assert from 'node:assert/strict';\n" +
        "import { clamp } from './clamp.mjs';\n" +
        "test('coerces', () => assert.strictEqual(clamp('3'), 3));\n",
    );
    return {
      stored,
      command: `cp '${stored}' 'oracle.test.mjs' && node --test 'oracle.test.mjs'`,
    };
  }

  it("reports the change as unreached and refuses to certify it", async () => {
    const oracle = await oracleThatSkipsTheBranch();
    try {
      const result = await verifyIndependently({
        repositoryRoot: repository,
        baseCommit: baseCommit(),
        patch: branchingPatch,
        commands: commands(),
        clock,
        taskOracle: { command: oracle.command },
      });

      expect(result.task).toBe("accepted");
      expect(result.oracleReach).toBe("unreached");
      expect(result.verified).toBe(false);
    } finally {
      await rm(oracle.stored, { force: true });
    }
  });

  /**
   * The advice has to name the finding that decided the verdict. On the real koa#1946 run it named
   * an inherited failure, which is true of that checkout and is not why the tool refused, and a
   * reader told the wrong reason goes and fixes the wrong thing.
   */
  it("says the oracle never ran the change rather than naming some other finding", async () => {
    const oracle = await oracleThatSkipsTheBranch();
    try {
      const result = await verifyIndependently({
        repositoryRoot: repository,
        baseCommit: baseCommit(),
        patch: branchingPatch,
        commands: commands(),
        clock,
        taskOracle: { command: oracle.command },
      });

      expect(result.advice).toContain("never ran");
    } finally {
      await rm(oracle.stored, { force: true });
    }
  });

  /** The other half of the same patch: an oracle that does take the branch is not blocked. */
  it("certifies where the oracle runs every line the patch added", async () => {
    const stored = join(repository, "..", `reaching-${Date.now()}.mjs`);
    await writeFile(
      stored,
      "import { test } from 'node:test';\n" +
        "import assert from 'node:assert/strict';\n" +
        "import { clamp } from './clamp.mjs';\n" +
        "test('coerces', () => assert.strictEqual(clamp('3'), 3));\n" +
        "test('floors', () => assert.strictEqual(clamp(-2), 0));\n",
    );
    try {
      const result = await verifyIndependently({
        repositoryRoot: repository,
        baseCommit: baseCommit(),
        patch: branchingPatch,
        commands: commands(),
        clock,
        taskOracle: {
          command: `cp '${stored}' 'oracle.test.mjs' && node --test 'oracle.test.mjs'`,
        },
      });

      expect(result.oracleReach).toBe("reached");
      expect(result.verified).toBe(true);
    } finally {
      await rm(stored, { force: true });
    }
  });
});

describe("reach measured on the tree the oracle judged", () => {
  /**
   * Attribution reverts the patch to see whether a failing check fails at the base too, and it
   * leaves the checkout there. Reach ran after it, so on any run with a failing check it read the
   * coverage of the base source, where the added line numbers are somebody else's lines.
   *
   * koa#1999 is that run: two failures its base already has, a patch whose five added lines the
   * oracle covers completely, and `unreached` every time. The task oracle already runs before
   * attribution for exactly this reason, and reach had the same requirement without the same
   * order.
   *
   * The fixture discriminates rather than merely passing. At the base, the added line numbers land
   * on a function the oracle never calls, so measuring there says unreached; on the patched tree
   * the oracle runs every added line.
   */
  it("measures the patched tree even when a failing check sent attribution to the base", async () => {
    await writeFile(
      join(repository, "clamp.mjs"),
      "export const clamp = (v) => v;\nexport const neverCalled = () => {\n  return 'unused';\n};\n",
    );
    await writeFile(
      join(repository, "inherited.test.mjs"),
      "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('fails at base too', () => assert.equal(1, 2));\n",
    );
    git(["add", "-A"], repository);
    git(["commit", "-qm", "a failure the base already has"], repository);

    const stored = join(repository, "..", `reaching-order-${Date.now()}.mjs`);
    await writeFile(
      stored,
      "import { test } from 'node:test';\n" +
        "import assert from 'node:assert/strict';\n" +
        "import { clamp } from './clamp.mjs';\n" +
        "test('coerces', () => assert.strictEqual(clamp('3'), 3));\n" +
        "test('floors', () => assert.strictEqual(clamp(-2), 0));\n",
    );

    try {
      const result = await verifyIndependently({
        repositoryRoot: repository,
        baseCommit: baseCommit(),
        patch: [
          "diff --git a/clamp.mjs b/clamp.mjs",
          "--- a/clamp.mjs",
          "+++ b/clamp.mjs",
          "@@ -1,4 +1,9 @@",
          "-export const clamp = (v) => v;",
          "+export const clamp = (v, low = 0) => {",
          "+  if (v < low) {",
          "+    return low;",
          "+  }",
          "+  return Number(v);",
          "+};",
          " export const neverCalled = () => {",
          "   return 'unused';",
          " };",
          "",
        ].join("\n"),
        commands: commands(),
        clock,
        taskOracle: {
          command: `cp '${stored}' 'oracle.test.mjs' && node --test 'oracle.test.mjs'`,
        },
      });

      expect(result.checks.some((check) => check.inheritedFromBase === true)).toBe(true);
      expect(result.oracleReach).toBe("reached");
    } finally {
      await rm(stored, { force: true });
    }
  });
});

describe("the tree the vacuity check leaves behind", () => {
  /**
   * The vacuity check stashes the patch, judges the base, and pops the stash back. The pop's exit
   * code was discarded, and it does not always succeed: an oracle puts its own test file in place
   * before running, so where the patch adds a file at that same path the pop finds it already
   * there and refuses. The patch is then still in the stash, and everything measured afterwards is
   * measured on the base.
   *
   * That is koa#1999 and koa#1904, whose patches add the very test file their oracle copies over.
   * Both are patches both oracles accept, and koa#1999 was refused for a reach gap that belongs to
   * the base source rather than to the patch.
   *
   * The fixture discriminates: at the base, the added line numbers land on a function the oracle
   * never calls, so a measurement taken there says unreached.
   */
  it("still holds the patch after judging the base, when the oracle owns a path the patch adds", async () => {
    await writeFile(
      join(repository, "clamp.mjs"),
      "export const clamp = (v) => v;\nexport const neverCalled = () => {\n  return 'unused';\n};\n",
    );
    git(["add", "-A"], repository);
    git(["commit", "-qm", "a function the oracle never calls"], repository);

    const stored = join(repository, "..", `owned-path-${Date.now()}.mjs`);
    await writeFile(
      stored,
      "import { test } from 'node:test';\n" +
        "import assert from 'node:assert/strict';\n" +
        "import { clamp } from './clamp.mjs';\n" +
        "test('coerces', () => assert.strictEqual(clamp('3'), 3));\n" +
        "test('floors', () => assert.strictEqual(clamp(-2), 0));\n",
    );

    try {
      const result = await verifyIndependently({
        repositoryRoot: repository,
        baseCommit: baseCommit(),
        // Touches the source and adds a test of its own, at the path the oracle copies over.
        patch: [
          "diff --git a/clamp.mjs b/clamp.mjs",
          "--- a/clamp.mjs",
          "+++ b/clamp.mjs",
          "@@ -1,4 +1,9 @@",
          "-export const clamp = (v) => v;",
          "+export const clamp = (v, low = 0) => {",
          "+  if (v < low) {",
          "+    return low;",
          "+  }",
          "+  return Number(v);",
          "+};",
          " export const neverCalled = () => {",
          "   return 'unused';",
          " };",
          "diff --git a/oracle.test.mjs b/oracle.test.mjs",
          "new file mode 100644",
          "--- /dev/null",
          "+++ b/oracle.test.mjs",
          "@@ -0,0 +1,2 @@",
          "+import { test } from 'node:test';",
          "+test('the model wrote this one', () => {});",
          "",
        ].join("\n"),
        commands: commands(),
        clock,
        taskOracle: {
          command: `cp '${stored}' 'oracle.test.mjs' && node --test 'oracle.test.mjs'`,
        },
      });

      expect(result.task).toBe("accepted");
      expect(result.oracleReach).toBe("reached");
    } finally {
      await rm(stored, { force: true });
    }
  });
});

describe("a tree the vacuity check could not put back", () => {
  /**
   * The vacuity check stashes the patch, judges the base, and restores. The restore's exit code
   * was discarded, so a restore that fails leaves the checkout at the base and everything measured
   * afterwards is measured on the wrong tree, silently, reported as though it were about the
   * patch.
   *
   * It fails in practice. An oracle puts its own test file in place before running, so where the
   * patch adds a file at that path the stash pop finds it already there and refuses. koa#1999 read
   * `unreached` for `lib/request.js:303`, a line the patch adds and its oracle covers, because 303
   * of the base file is a line nothing in the oracle runs.
   *
   * A measurement on a tree the harness cannot confirm is not a measurement, so it abstains by
   * name rather than reporting a verdict about lines it never saw.
   */
  it("abstains on reach rather than measuring whatever the tree happens to hold", async () => {
    const commands = createNodeCommandRunner(clock, harnessChildEnvironment());
    const refusingToRestore = {
      run: commands.run.bind(commands),
      runVouched: (argv: readonly string[], options: { cwd: string; timeoutMs: number }) =>
        argv.includes("apply") && argv.includes("--3way")
          ? Promise.resolve({
              exitCode: 1,
              stdout: "",
              stderr: "patch does not apply",
              durationMs: 0,
              unavailable: null,
            })
          : commands.runVouched(argv, options),
    };

    const stored = join(repository, "..", `unrestorable-${Date.now()}.mjs`);
    await writeFile(
      stored,
      "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { clamp } from './clamp.mjs';\ntest('coerces', () => assert.strictEqual(clamp('3'), 3));\n",
    );

    try {
      const result = await verifyIndependently({
        repositoryRoot: repository,
        baseCommit: baseCommit(),
        patch: [
          "diff --git a/clamp.mjs b/clamp.mjs",
          "--- a/clamp.mjs",
          "+++ b/clamp.mjs",
          "@@ -1 +1 @@",
          "-export const clamp = (v) => v;",
          "+export const clamp = (v) => Number(v);",
          "",
        ].join("\n"),
        commands: refusingToRestore,
        clock,
        taskOracle: {
          command: `cp '${stored}' 'oracle.test.mjs' && node --test 'oracle.test.mjs'`,
        },
      });

      expect(result.oracleReach).toBe("unmeasured");
      expect(result.advice).toContain("could not be put back");
    } finally {
      await rm(stored, { force: true });
    }
  });
});
