import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { capturedRegression } from "../evidence/verifier/status.mjs";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { containerRuntimeAvailable, createContainerBackend } from "../exec/container-backend.ts";
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

it.skipIf(!containerRuntimeAvailable("docker"))(
  "verifies and restores a patch when the checkout is mounted at a different container path",
  async () => {
    const checkoutRoot = await mkdtemp(join(homedir(), ".swarm-verification-test-"));
    try {
      await writeFile(
        join(repository, "clamp.mjs"),
        "export const clamp = (v) => Math.max(0, v);\n",
      );
      const patch = execFileSync("git", ["diff", "HEAD"], { cwd: repository, encoding: "utf8" });
      const verification = await verifyIndependently({
        repositoryRoot: repository,
        checkoutRoot,
        baseCommit: baseCommit(),
        patch,
        commands: commands(),
        commandsForCheckout: async (checkout) =>
          createNodeCommandRunner(
            clock,
            harnessChildEnvironment(),
            createContainerBackend({
              runtime: "docker",
              image: "node:24-bookworm",
              workspaceRoot: checkout,
              user: `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
            }),
          ),
        taskOracle: {
          command: `node --input-type=module -e "import {clamp} from './clamp.mjs'; import assert from 'node:assert/strict'; assert.equal(clamp(-1),0)"`,
        },
        clock,
        timeoutMs: 30000,
      });
      expect(verification.applied).toBe(true);
      expect(verification.regression).toBe("pass");
      expect(verification.task).toBe("accepted");
      expect(verification.verified).toBe(true);
    } finally {
      await rm(checkoutRoot, { recursive: true, force: true });
    }
  },
  60000,
);

describe("verification that does not trust the tree it is verifying", () => {
  it("measures an unchanged candidate without requiring git apply's newer empty-patch flag", async () => {
    const ordinary = commands();
    const invoked: string[][] = [];
    const verification = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch: "",
      commands: {
        ...ordinary,
        runVouched: async (argv, options) => {
          invoked.push([...argv]);
          if (argv.includes("--allow-empty")) throw new Error("unsupported on Git 2.30");
          return ordinary.runVouched(argv, options);
        },
      },
      clock,
    });
    expect(verification.applied).toBe(true);
    expect(verification.regression).toBe("pass");
    expect(verification.task).toBe("unjudged");
    expect(verification.verified).toBe(false);
    expect(invoked).toContainEqual(["git", "diff", "--exit-code", "HEAD", "--"]);
  });

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
    // Both routes' way of asking for it: the Action passes `install: true` as --install.
    expect(result.advice).toContain("`install: true` in the Action's inputs");
  }, 180_000);

  it("does not ask for an install that already ran when a runner is still missing", async () => {
    // gemma-witness's workflow set `install: true`; its Rust checks read "not installed" and the
    // advice still said to pass --install.
    await writeFile(
      join(repository, "package.json"),
      '{"name":"w","version":"1.0.0","type":"module","scripts":{"test":"definitely-not-a-runner run"}}\n',
    );
    await writeFile(
      join(repository, "package-lock.json"),
      JSON.stringify({
        name: "w",
        version: "1.0.0",
        lockfileVersion: 3,
        requires: true,
        packages: { "": { name: "w", version: "1.0.0" } },
      }),
    );
    git(["add", "-A"], repository);
    git(["commit", "-qm", "needs a runner no lockfile provides"], repository);
    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch:
        "diff --git a/clamp.mjs b/clamp.mjs\n--- a/clamp.mjs\n+++ b/clamp.mjs\n@@ -1 +1 @@\n-export const clamp = (v) => v;\n+export const clamp = (v) => v;\n",
      installDependencies: true,
      commands: commands(),
      clock,
    });
    expect(result.install?.succeeded).toBe(true);
    expect(result.unmeasured).toBe(true);
    expect(result.advice).toContain("Dependencies were installed from the lockfile");
    expect(result.advice).not.toContain("authorize lockfile setup");
  }, 300_000);

  it("says why no check was planned rather than listing none", async () => {
    // nondet (Java) and a rules repository with no manifest read "every check stood down ()".
    git(["rm", "-q", "package.json"], repository);
    git(["commit", "-qm", "no manifest"], repository);
    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch:
        "diff --git a/clamp.mjs b/clamp.mjs\n--- a/clamp.mjs\n+++ b/clamp.mjs\n@@ -1 +1 @@\n-export const clamp = (v) => v;\n+export const clamp = (v) => 0;\n",
      commands: commands(),
      clock,
    });
    expect(result.checks).toEqual([]);
    expect(result.unmeasured).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.advice).toContain(
      "no check was planned, because no package.json, pyproject.toml, Cargo.toml, or go.mod was found",
    );
    expect(result.advice).not.toContain("()");
  }, 180_000);

  it("installs from the lockfile when asked, so the checks can run", async () => {
    // node --test needs nothing installed, so this shows the phase runs and reports rather than
    // that a particular package manager works: installing is a decision, and it is recorded.
    await writeFile(
      join(repository, "package-lock.json"),
      JSON.stringify({
        name: "w",
        version: "1.0.0",
        lockfileVersion: 3,
        requires: true,
        packages: { "": { name: "w", version: "1.0.0" } },
      }),
    );
    git(["add", "package-lock.json"], repository);
    git(["commit", "-qm", "pin dependency-free environment"], repository);
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
    // The patch broke nothing, so the verification must not say it did; and with nothing
    // passing either, nothing here establishes that it did not.
    expect(result.regression).toBe("unmeasured");
  });

  /**
   * The base control measured the inherited failure at the base, which is a measurement about
   * the base and not about the patch; with another check passing, the regression dimension
   * passes and the inherited failure is named beside it. Ten of twenty-two adjudicated-correct
   * pull requests in the AI-authored study read as refused for a lint or format failure their
   * base carried before this.
   */
  it("passes the regression dimension when every failure is inherited and another check passed", async () => {
    await writeFile(
      join(repository, "package.json"),
      '{"name":"w","version":"1.0.0","type":"module","scripts":{"test":"node --test","lint":"node -e 0"}}\n',
    );
    await writeFile(
      join(repository, "broken.test.mjs"),
      "import { test } from 'node:test';\ntest('already broken', () => { throw new Error('base'); });\n",
    );
    git(["add", "-A"], repository);
    git(["commit", "-qm", "a base that already fails, with a linter that passes"], repository);

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

    expect(result.checks.find((check) => check.id === "tests")?.inheritedFromBase).toBe(true);
    expect(result.checks.find((check) => check.id === "lint")?.status).toBe("passed");
    expect(result.regression).toBe("pass");
    expect(result.verified).toBe(false);
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
   * A check that fails both ways was read as inherited whatever else the patch broke inside it:
   * a base with one failing test and a patch that broke a second read as a regression pass
   * wherever another check passed. The tests the patched run fails are compared with the base's.
   */
  it("calls a newly broken test a regression even when the base already had a failing one", async () => {
    await writeFile(
      join(repository, "package.json"),
      '{"name":"w","version":"1.0.0","type":"module","scripts":{"test":"node --test","lint":"node -e 0"}}\n',
    );
    await writeFile(
      join(repository, "broken.test.mjs"),
      "import { test } from 'node:test';\ntest('already broken', () => { throw new Error('base'); });\n",
    );
    git(["add", "-A"], repository);
    git(["commit", "-qm", "a base that already fails, with a linter that passes"], repository);
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
    expect(tests?.attribution).toBe("new");
    expect(tests?.inheritedFromBase).toBe(false);
    expect(tests?.newFailures).toEqual(["clamp.test.mjs:4:1 › 0:identity"]);
    expect(result.regression).toBe("fail");
    // The offline verifier, a second implementation, reads the same regression from the record.
    expect(capturedRegression(result.checks)).toBe(result.regression);
    expect(result.advice).toContain("newly failing: clamp.test.mjs:4:1 › 0:identity");
  });

  /**
   * A check whose output names no tests is inherited only where it printed the same thing at
   * the base. A linter that reports one problem at the base and two with the patch may hide a
   * problem the patch introduced, so the dimension is unmeasured, never passed.
   */
  it("leaves the regression unmeasured where a failure changed in a way it cannot compare", async () => {
    await writeFile(
      join(repository, "package.json"),
      '{"name":"w","version":"1.0.0","type":"module","scripts":{"test":"node --test","lint":"node lint.mjs"}}\n',
    );
    await writeFile(
      join(repository, "lint.mjs"),
      "import { readFileSync } from 'node:fs';\nconst n = (readFileSync('clamp.mjs', 'utf8').match(/=>/g) ?? []).length;\nconsole.log(`${n} problem(s)`);\nprocess.exit(1);\n",
    );
    git(["add", "-A"], repository);
    git(["commit", "-qm", "a linter that already fails"], repository);
    const patch = [
      "diff --git a/clamp.mjs b/clamp.mjs",
      "--- a/clamp.mjs",
      "+++ b/clamp.mjs",
      "@@ -1 +1 @@",
      "-export const clamp = (v) => v;",
      "+export const clamp = (v) => [3].map((x) => x)[0] + v - 3;",
      "",
    ].join("\n");

    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch,
      commands: commands(),
      clock,
    });

    const lint = result.checks.find((check) => check.id === "lint");
    expect(lint?.attribution).toBe("unattributed");
    expect(lint?.inheritedFromBase).toBe(false);
    expect(result.checks.find((check) => check.id === "tests")?.status).toBe("passed");
    expect(result.regression).toBe("unmeasured");
    // The offline verifier, a second implementation, reads the same regression from the record.
    expect(capturedRegression(result.checks)).toBe(result.regression);
  });

  it("still inherits a failure the base printed identically", async () => {
    await writeFile(
      join(repository, "package.json"),
      '{"name":"w","version":"1.0.0","type":"module","scripts":{"test":"node --test","lint":"node -e \\"console.log(\'1 problem (0.2s)\');process.exit(1)\\""}}\n',
    );
    git(["add", "-A"], repository);
    git(["commit", "-qm", "a linter that always reports the same problem"], repository);
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

    expect(result.checks.find((check) => check.id === "lint")?.attribution).toBe("inherited");
    expect(result.regression).toBe("pass");
    // The offline verifier, a second implementation, reads the same regression from the record.
    expect(capturedRegression(result.checks)).toBe(result.regression);
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

describe("a patch that changes the runner's configuration", () => {
  /**
   * The runner below loads a configuration file into its own process, as Vitest does, and a
   * patch added one that printed a passing report and exited before any test ran. The command
   * comes from the base; so does the rest of the instrument.
   */
  const runner = [
    "import { existsSync } from 'node:fs';",
    "import { spawnSync } from 'node:child_process';",
    "if (existsSync('vitest.config.mjs')) await import(new URL('./vitest.config.mjs', import.meta.url));",
    "const ran = spawnSync(process.execPath, ['--test', '--test-reporter=tap'], { stdio: 'inherit' });",
    "process.exit(ran.status ?? 1);",
    "",
  ].join("\n");
  beforeEach(async () => {
    await writeFile(
      join(repository, "package.json"),
      '{"name":"w","version":"1.0.0","type":"module","scripts":{"test":"node runner.mjs"}}\n',
    );
    await writeFile(join(repository, "runner.mjs"), runner);
    git(["add", "-A"], repository);
    git(["commit", "-qm", "a runner that reads its configuration in process"], repository);
  });
  const added = (path: string, lines: readonly string[]) => [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
  ];
  const forged = added("vitest.config.mjs", [
    "process.stdout.write('TAP version 13\\nok 1 - identity\\n1..1\\n# tests 1\\n# pass 1\\n# fail 0\\n');",
    "process.exit(0);",
  ]);
  const broken = [
    "diff --git a/clamp.mjs b/clamp.mjs",
    "--- a/clamp.mjs",
    "+++ b/clamp.mjs",
    "@@ -1 +1 @@",
    "-export const clamp = (v) => v;",
    "+export const clamp = (v) => 999;",
  ];

  it("does not pass a forged report; the base's configuration shows the test it broke", async () => {
    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch: [...broken, ...forged, ""].join("\n"),
      commands: commands(),
      clock,
    });

    const tests = result.checks.find((check) => check.id === "tests");
    expect(tests?.configurationFiles).toEqual(["vitest.config.mjs"]);
    expect(tests?.configurationStatus).toBe("failed");
    expect(tests?.status).toBe("failed");
    expect(tests?.regressedUnderBaseConfiguration).toEqual(["clamp.test.mjs:4:1 › 0:identity"]);
    expect(result.regression).toBe("fail");
    // The offline verifier, a second implementation, reads the same regression from the record.
    expect(capturedRegression(result.checks)).toBe(result.regression);
  });

  it("measures nothing, rather than passing, where only a test the base lacks needs the new configuration", async () => {
    const needsConfiguration = added("configured.test.mjs", [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "test('configured', () => assert.equal(process.env.CONFIGURED, '1'));",
    ]);
    const configuration = added("vitest.config.mjs", ["process.env.CONFIGURED = '1';"]);
    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch: [...needsConfiguration, ...configuration, ""].join("\n"),
      commands: commands(),
      clock,
    });

    const tests = result.checks.find((check) => check.id === "tests");
    expect(tests?.configurationStatus).toBe("failed");
    expect(tests?.status).toBe("not-applicable");
    expect(result.regression).toBe("unmeasured");
    // The offline verifier, a second implementation, reads the same regression from the record.
    expect(capturedRegression(result.checks)).toBe(result.regression);
  });

  it("changes nothing where the base's configuration passes too", async () => {
    const harmless = added("vitest.config.mjs", ["export default {};"]);
    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch: [...harmless, ""].join("\n"),
      commands: commands(),
      clock,
    });

    expect(result.checks.find((check) => check.id === "tests")?.status).toBe("passed");
    expect(result.regression).toBe("pass");
    // The offline verifier, a second implementation, reads the same regression from the record.
    expect(capturedRegression(result.checks)).toBe(result.regression);
  });
});

describe("the oracle's environment and its record", () => {
  const patch = [
    "diff --git a/clamp.mjs b/clamp.mjs",
    "--- a/clamp.mjs",
    "+++ b/clamp.mjs",
    "@@ -1 +1 @@",
    "-export const clamp = (v) => v;",
    "+export const clamp = (v) => (v < 0 ? 0 : v);",
    "",
  ].join("\n");

  /**
   * An A2 study run wrote its oracle as `python -m pytest ...`; inside the uv image that reached
   * the image's interpreter rather than the project's `.venv`, and the patch read as rejected.
   */
  it("finds a program the project environment provides, as `uv run` would", async () => {
    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch,
      commands: commands(),
      clock,
      taskOracle: {
        command:
          "mkdir -p .venv/bin && printf '#!/bin/sh\\necho from the project environment\\n' > .venv/bin/project-tool && chmod +x .venv/bin/project-tool && project-tool && grep -q 'v < 0' clamp.mjs",
      },
    });

    expect(result.task).toBe("accepted");
    expect(result.oracleRuns?.[0]?.outputTail).toContain("from the project environment");
  });

  it("keeps what a refusing oracle printed and exited with", async () => {
    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch,
      commands: commands(),
      clock,
      taskOracle: { command: "echo 'the expected floor is 1' >&2; exit 3" },
    });

    expect(result.task).toBe("rejected");
    expect(result.oracleRuns).toEqual([
      expect.objectContaining({
        tree: "patched",
        command: "echo 'the expected floor is 1' >&2; exit 3",
        exitCode: 3,
        outputTail: "the expected floor is 1\n",
      }),
    ]);
  });
});

describe("an oracle that leaves its own files in the checkout", () => {
  /**
   * A mined task's oracle copies the pull request's whole test file into the checkout and runs one
   * half of it by title. The file stays. Anything that runs the repository's own suite afterwards
   * runs both halves: the held-back cases fail on the base by construction, and they fail on a
   * mutant the visible half accepted. Neither is the repository speaking.
   */
  let stored = "";
  beforeEach(async () => {
    stored = await mkdtemp(join(tmpdir(), "swarm-stored-oracle-"));
  });
  afterEach(async () => {
    await rm(stored, { recursive: true, force: true });
  });

  const oracleCopying = async (file: string, title: string) => {
    const path = join(stored, "pr.test.mjs");
    await writeFile(path, file);
    return `mkdir -p hidden && cp '${path}' hidden/pr.test.mjs && node --test --test-name-pattern='${title}' hidden/pr.test.mjs`;
  };

  it("still calls a regression the patch caused a regression, whatever the oracle left behind", async () => {
    const command = await oracleCopying(
      [
        "import { test } from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import { clamp } from '../clamp.mjs';",
        "test('visible floors a negative', () => assert.equal(clamp(-1), 0));",
        "",
      ].join("\n"),
      "visible",
    );
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
      taskOracle: { command },
    });

    // The copied file fails on the base too; measured beside it, the base looked as broken as
    // the patch and the regression read as inherited.
    const tests = result.checks.find((check) => check.id === "tests");
    expect(tests?.status).toBe("failed");
    expect(tests?.inheritedFromBase).toBe(false);
    expect(result.regression).toBe("fail");
  });

  it("does not let the held-back cases witness a mutant the repository's suite cannot see", async () => {
    const command = await oracleCopying(
      [
        "import { test } from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import { floor0 } from '../clamp.mjs';",
        "test('visible does not throw', () => assert.doesNotThrow(() => floor0(-5)));",
        "test('held back floors a negative', () => assert.equal(floor0(-5), 0));",
        "",
      ].join("\n"),
      "visible",
    );
    const patch = [
      "diff --git a/clamp.mjs b/clamp.mjs",
      "--- a/clamp.mjs",
      "+++ b/clamp.mjs",
      "@@ -1 +1,5 @@",
      " export const clamp = (v) => v;",
      "+export function floor0(v) {",
      "+  const floored = Math.max(0, v);",
      "+  return floored;",
      "+}",
      "",
    ].join("\n");

    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch,
      commands: commands(),
      clock,
      taskOracle: { command },
    });

    expect(result.task).toBe("accepted");
    expect(result.regression).toBe("pass");
    const assigned = result.bondedMutants.find((one) => one.operator === "replace-assigned-value");
    // The visible half ran the line and accepted the mutant. Coverage saw the same lines run, and
    // the repository's own suite, clamp.test.mjs, never calls floor0: nothing but the held-back
    // case could have noticed, so nothing witnessed it.
    expect(assigned).toMatchObject({ line: 3, verdict: "vacuous", witness: "none" });
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

/**
 * A second judgement of the same patch by a different oracle needs the oracle's verdict and
 * nothing else: the repository's own suite answers the same way both times, and running it again
 * is the same minutes spent twice. On the mined corpus that is most of a campaign, because dayjs
 * runs its suite under four timezones and every task is judged two or three times.
 *
 * Skipping is not passing. `regression` is `unmeasured`, `verified` is false, and the advice says
 * the checks were not asked for, because a run that did not measure the suite cannot certify.
 */
describe("a verification asked only for the oracle's verdict", () => {
  const patch = [
    "diff --git a/clamp.mjs b/clamp.mjs",
    "--- a/clamp.mjs",
    "+++ b/clamp.mjs",
    "@@ -1 +1 @@",
    "-export const clamp = (v) => v;",
    "+export const clamp = (v) => (v < 0 ? 0 : v);",
    "",
  ].join("\n");

  it("judges the oracle and reports the suite as unmeasured rather than passed", async () => {
    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch,
      commands: commands(),
      clock,
      repositoryChecks: "skip",
      taskOracle: {
        command:
          "node -e \"import('./clamp.mjs').then(m => process.exit(m.clamp(-1) === 0 ? 0 : 1))\"",
      },
    });

    expect(result.task).toBe("accepted");
    expect(result.checks).toEqual([]);
    expect(result.regression).toBe("unmeasured");
    expect(result.verified).toBe(false);
    expect(result.advice).toContain("were not asked for");
  });

  it("still runs them when nothing asked it not to", async () => {
    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch,
      commands: commands(),
      clock,
      taskOracle: {
        command:
          "node -e \"import('./clamp.mjs').then(m => process.exit(m.clamp(-1) === 0 ? 0 : 1))\"",
      },
    });

    expect(result.checks.length).toBeGreaterThan(0);
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

/**
 * The arm that reads V8's own coverage, which is what reach falls back to wherever the harness
 * cannot rebuild the oracle as a node test-runner invocation. Thirteen of the seventeen mined
 * repositories are in that position, and reach was blind on every one of them.
 *
 * The oracle here is a plain node script rather than node's test runner, which is the shape the
 * vouching refuses and the coverage plan still recognizes. Both directions are exercised, because
 * an arm that only ever answers `unreached` would pass a test that only checks the gap.
 */
describe("reach read from the coverage the run itself wrote", () => {
  // Two things at once, which is the shape reach exists for: a coercion the oracle's own
  // assertion detects, and a floor branch it never takes.
  const patch = [
    "diff --git a/clamp.mjs b/clamp.mjs",
    "--- a/clamp.mjs",
    "+++ b/clamp.mjs",
    "@@ -1 +1,7 @@",
    "-export const clamp = (v) => v;",
    "+export const clamp = (v) => {",
    "+  const n = Number(v);",
    "+  if (n < 0) {",
    "+    return 0;",
    "+  }",
    "+  return n;",
    "+};",
    "",
  ].join("\n");

  async function oracleScript(body: string): Promise<string> {
    const script = join(repository, "..", `reach-v8-${Date.now()}-${Math.random()}.mjs`);
    await writeFile(script, body);
    return script;
  }

  it("names the added line an oracle of its own never ran", async () => {
    const script = await oracleScript(
      "import assert from 'node:assert/strict';\n" +
        "import { clamp } from './clamp.mjs';\n" +
        "assert.strictEqual(clamp('3'), 3);\n",
    );
    try {
      const result = await verifyIndependently({
        repositoryRoot: repository,
        baseCommit: baseCommit(),
        patch,
        commands: commands(),
        clock,
        taskOracle: { command: `cp '${script}' oracle.mjs && node oracle.mjs` },
      });

      expect(result.task).toBe("accepted");
      expect(result.oracleReach).toBe("unreached");
      expect(result.unreachedByOracle.map((file) => file.path)).toEqual(["clamp.mjs"]);
      expect(result.unreachedByOracle[0]?.lines).toContain(4);
      expect(result.verified).toBe(false);
    } finally {
      await rm(script, { force: true });
    }
  });

  it("reports reached where the same oracle takes the branch as well", async () => {
    const script = await oracleScript(
      "import assert from 'node:assert/strict';\n" +
        "import { clamp } from './clamp.mjs';\n" +
        "assert.strictEqual(clamp('3'), 3);\n" +
        "assert.strictEqual(clamp(-2), 0);\n",
    );
    try {
      const result = await verifyIndependently({
        repositoryRoot: repository,
        baseCommit: baseCommit(),
        patch,
        commands: commands(),
        clock,
        taskOracle: { command: `cp '${script}' oracle.mjs && node oracle.mjs` },
      });

      expect(result.oracleReach).toBe("reached");
      expect(result.verified).toBe(true);
    } finally {
      await rm(script, { force: true });
    }
  });

  it("names a type test it set aside beside a verdict of reached", async () => {
    const withTypeTest = `${patch}${[
      "diff --git a/typings/index.test-d.ts b/typings/index.test-d.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/typings/index.test-d.ts",
      "@@ -0,0 +1 @@",
      "+expectType<number>(clamp('3'));",
      "",
    ].join("\n")}`;
    const script = await oracleScript(
      "import assert from 'node:assert/strict';\n" +
        "import { clamp } from './clamp.mjs';\n" +
        "assert.strictEqual(clamp('3'), 3);\n" +
        "assert.strictEqual(clamp(-2), 0);\n",
    );
    try {
      const result = await verifyIndependently({
        repositoryRoot: repository,
        baseCommit: baseCommit(),
        patch: withTypeTest,
        commands: commands(),
        clock,
        taskOracle: { command: `cp '${script}' oracle.mjs && node oracle.mjs` },
      });

      expect(result.oracleReach).toBe("reached");
      expect(result.unreachedByOracle).toEqual([]);
      expect(result.setAsideByReach).toEqual([
        { path: "typings/index.test-d.ts", reason: "type-test" },
      ]);
    } finally {
      await rm(script, { force: true });
    }
  });

  it("abstains, and does not read reached, where no changed file could be measured", async () => {
    const notesOnly = [
      "diff --git a/NOTES.md b/NOTES.md",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/NOTES.md",
      "@@ -0,0 +1 @@",
      "+clamp coerces strings",
      "",
    ].join("\n");
    const script = await oracleScript(
      "import assert from 'node:assert/strict';\n" +
        "import { readFileSync } from 'node:fs';\n" +
        "assert.match(readFileSync('NOTES.md', 'utf8'), /coerces/);\n",
    );
    try {
      const result = await verifyIndependently({
        repositoryRoot: repository,
        baseCommit: baseCommit(),
        patch: notesOnly,
        commands: commands(),
        clock,
        taskOracle: { command: `cp '${script}' oracle.mjs && node oracle.mjs` },
      });

      expect(result.task).toBe("accepted");
      expect(result.oracleReach).toBe("unmeasured");
      expect(result.setAsideByReach).toEqual([{ path: "NOTES.md", reason: "no-runner-loads-it" }]);
      // Not a refusal: an unknown measurement is unknown, and certification reads it as that.
      expect(result.verified).toBe(true);
    } finally {
      await rm(script, { force: true });
    }
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

/**
 * Bonding the oracle: after it accepts, the lines the patch added are changed into something that
 * behaves differently and it is run again. Reach asks whether the oracle executed the change; this
 * asks whether executing it established anything, which is the question commander#1671 turns on.
 *
 * Both directions are here, because a check that only ever reports a gap has not been shown able
 * to say the oracle was adequate and is worth nothing.
 */
describe("whether the oracle refuses a change to the lines the patch added", () => {
  const branchingPatch = [
    "diff --git a/clamp.mjs b/clamp.mjs",
    "--- a/clamp.mjs",
    "+++ b/clamp.mjs",
    "@@ -1 +1,7 @@",
    "-export const clamp = (v) => v;",
    "+export const clamp = (v) => {",
    "+  const n = Number(v);",
    "+  if (n < 0) {",
    "+    return 0;",
    "+  }",
    "+  return n;",
    "+};",
    "",
  ].join("\n");

  async function oracleScript(body: string): Promise<string> {
    const script = join(repository, "..", `bond-${Date.now()}-${Math.random()}.mjs`);
    await writeFile(script, body);
    return script;
  }

  it("holds where the oracle refuses every mutant of the change", async () => {
    const script = await oracleScript(
      "import assert from 'node:assert/strict';\n" +
        "import { clamp } from './clamp.mjs';\n" +
        "assert.strictEqual(clamp('3'), 3);\n" +
        "assert.strictEqual(clamp(-2), 0);\n",
    );
    try {
      const result = await verifyIndependently({
        repositoryRoot: repository,
        baseCommit: baseCommit(),
        patch: branchingPatch,
        commands: commands(),
        clock,
        taskOracle: { command: `cp '${script}' oracle.mjs && node oracle.mjs` },
      });

      expect(result.oracleReach).toBe("reached");
      expect(result.oracleBond).toBe("held");
      expect(result.bondedMutants.map((one) => one.operator)).toContain("invert-comparison");
      expect(result.bondedMutants.every((one) => one.verdict === "held")).toBe(true);
      expect(result.verified).toBe(true);
    } finally {
      await rm(script, { force: true });
    }
  });

  /**
   * The commander#1671 shape, reduced, and the residual the adjudication leaves. Every line the
   * patch adds runs under the oracle, and the precedence those lines decide is one `.reverse()`
   * the oracle never tests: merging two objects that share no key gives the same answer either
   * way. So the oracle accepts a mutant of a line it ran, which used to be `vacuous` on the
   * strength of a person reading the line and calling it behaviour-changing.
   *
   * Neither detector can witness it. Coverage sees the same lines run the same number of times in
   * a different order, and the repository's own suite never had the precedence this patch adds. So
   * the refusal stands on what `vacuous` has always meant, that the oracle ran the line and
   * accepted a change to it, and the record says no detector corroborated it. Which of those two
   * facts the verdict rests on is one boolean in `mutant-witness.ts`, measured both ways in
   * `docs/oracle-bond-operators.md`.
   */
  it("refuses on an accepted mutant of a line it ran, and says nothing witnessed it", async () => {
    const patch = [
      "diff --git a/merge.mjs b/merge.mjs",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/merge.mjs",
      "@@ -0,0 +1,7 @@",
      "+export const merge = (parents) => {",
      "+  const merged = {};",
      "+  parents.reverse().forEach((one) => {",
      "+    Object.assign(merged, one);",
      "+  });",
      "+  return merged;",
      "+};",
      "",
    ].join("\n");
    const script = await oracleScript(
      "import assert from 'node:assert/strict';\n" +
        "import { merge } from './merge.mjs';\n" +
        "assert.deepStrictEqual(merge([{ a: 1 }, { b: 2 }]), { a: 1, b: 2 });\n",
    );
    try {
      const result = await verifyIndependently({
        repositoryRoot: repository,
        baseCommit: baseCommit(),
        patch,
        commands: commands(),
        clock,
        taskOracle: { command: `cp '${script}' oracle.mjs && node oracle.mjs` },
      });

      expect(result.oracleReach).toBe("reached");
      const dropped = result.bondedMutants.find((one) => one.operator === "drop-chained-call");
      expect(dropped?.after).toBe("  parents.forEach((one) => {");
      expect(dropped?.verdict).toBe("vacuous");
      // Both detectors were asked and neither answered, which is recorded rather than required.
      expect(dropped?.witness).toBe("none");
      expect(result.oracleBond).toBe("vacuous");
      expect(result.verified).toBe(false);
    } finally {
      await rm(script, { force: true });
    }
  });

  it("leaves the checkout as the patch left it, whatever the mutants did", async () => {
    const script = await oracleScript(
      "import assert from 'node:assert/strict';\n" +
        "import { clamp } from './clamp.mjs';\n" +
        "assert.strictEqual(clamp(-2), 0);\n",
    );
    try {
      const result = await verifyIndependently({
        repositoryRoot: repository,
        baseCommit: baseCommit(),
        patch: branchingPatch,
        commands: commands(),
        clock,
        taskOracle: { command: `cp '${script}' oracle.mjs && node oracle.mjs` },
      });

      // The repository's own suite ran before any mutant existed, and the base comparison after
      // them: a mutant left behind would charge the patch with a failure nothing in it caused.
      expect(result.regression).toBe("pass");
      expect(result.checks.some((check) => check.status === "failed")).toBe(false);
    } finally {
      await rm(script, { force: true });
    }
  });

  /**
   * The coverage detector, which is the one that reaches behaviour the project did not have
   * before. The oracle runs the guard and asserts only on the returned length, so inverting the
   * comparison leaves the assertion true and stops a line inside the guard from running at all.
   * That is a demonstrated difference in what the program did, and the oracle accepted it.
   */
  it("reports a gap where coverage shows the accepted mutant changed what ran", async () => {
    const patch = [
      "diff --git a/count.mjs b/count.mjs",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/count.mjs",
      "@@ -0,0 +1,7 @@",
      "+const seen = [];",
      "+export const size = (all) => {",
      "+  if (all.length > 0) {",
      "+    seen.push(all.length);",
      "+  }",
      "+  return all.length;",
      "+};",
      "",
    ].join("\n");
    const script = await oracleScript(
      "import assert from 'node:assert/strict';\n" +
        "import { size } from './count.mjs';\n" +
        "assert.strictEqual(size([1, 2]), 2);\n",
    );
    try {
      const result = await verifyIndependently({
        repositoryRoot: repository,
        baseCommit: baseCommit(),
        patch,
        commands: commands(),
        clock,
        taskOracle: { command: `cp '${script}' oracle.mjs && node oracle.mjs` },
      });

      expect(result.oracleBond).toBe("vacuous");
      const gap = result.bondedMutants.find((one) => one.verdict === "vacuous");
      expect(gap?.operator).toBe("invert-comparison");
      expect(gap?.witness).toBe("coverage");
      expect(result.verified).toBe(false);
    } finally {
      await rm(script, { force: true });
    }
  });

  /**
   * `not-bonded` is what is left once ordinary statements are covered: a patch adding no line
   * with behaviour on it. It used to be what a guard clause, an assignment or a `require` got.
   */
  it("bonds nothing where the patch adds no line with behaviour on it", async () => {
    const patch = [
      "diff --git a/clamp.mjs b/clamp.mjs",
      "--- a/clamp.mjs",
      "+++ b/clamp.mjs",
      "@@ -1 +1,2 @@",
      "+// a clamped value is a number",
      " export const clamp = (v) => v;",
      "",
    ].join("\n");

    const result = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: baseCommit(),
      patch,
      commands: commands(),
      clock,
      taskOracle: { command: "node -e \"import('./clamp.mjs')\"" },
    });

    expect(result.oracleBond).toBe("not-bonded");
    expect(result.bondedMutants).toEqual([]);
  });
});

/**
 * The bond and reach answer different questions, so one does not gate the other. Tying them
 * together cost the answer that matters most for reading a gap: what a second oracle does with the
 * same mutant, which is only measurable where its own run is bonded too.
 */
describe("bonding an oracle whose reach came back unreached", () => {
  it("still asks the oracle to refuse a mutant of what it did run", async () => {
    const patch = [
      "diff --git a/clamp.mjs b/clamp.mjs",
      "--- a/clamp.mjs",
      "+++ b/clamp.mjs",
      "@@ -1 +1,7 @@",
      "-export const clamp = (v) => v;",
      "+export const clamp = (v) => {",
      "+  const n = Number(v);",
      "+  if (n < 0) {",
      "+    return 0;",
      "+  }",
      "+  return n;",
      "+};",
      "",
    ].join("\n");
    const script = join(repository, "..", `unreached-bond-${Date.now()}.mjs`);
    await writeFile(
      script,
      "import assert from 'node:assert/strict';\n" +
        "import { clamp } from './clamp.mjs';\n" +
        "assert.strictEqual(clamp('3'), 3);\n",
    );
    try {
      const result = await verifyIndependently({
        repositoryRoot: repository,
        baseCommit: baseCommit(),
        patch,
        commands: commands(),
        clock,
        taskOracle: { command: `cp '${script}' oracle.mjs && node oracle.mjs` },
      });

      expect(result.oracleReach).toBe("unreached");
      expect(result.oracleBond).toBe("held");
      expect(result.verified).toBe(false);
    } finally {
      await rm(script, { force: true });
    }
  });
});

it("runs an externally authored omission check even when the old suite passes", async () => {
  const { digestOfBytes } = await import("../evidence/canonical-json.ts");
  const { openEvidenceSession } = await import("../evidence/session.ts");
  const { acceptancePackageExecutor } = await import("./acceptance-package.ts");
  const artifact =
    "import { test } from 'node:test'; import assert from 'node:assert/strict'; import { clamp } from '../clamp.mjs'; test('upper bound is required',()=>assert.equal(clamp(20),10));\n";
  const patch =
    "diff --git a/clamp.mjs b/clamp.mjs\n--- a/clamp.mjs\n+++ b/clamp.mjs\n@@ -1 +1 @@\n-export const clamp = (v) => v;\n+export const clamp = (v) => Math.max(0,v);\n";
  const reference = patch.replace("Math.max(0,v)", "Math.min(10,Math.max(0,v))");
  const digest = digestOfBytes(artifact);
  const root = await mkdtemp(join(tmpdir(), "swarm-required-obligation-"));
  try {
    const evidence = await openEvidenceSession({ root, sessionId: "verification", clock });
    const commands = createNodeCommandRunner(clock, harnessChildEnvironment());
    const contract = {
      version: 1,
      author: "external fixture author",
      taskId: "both clamp bounds",
      exposure: "public",
      immutablePaths: ["clamp.test.mjs"],
      requirements: [
        {
          id: "upper-bound",
          artifactDigest: digest,
          argv: ["node", "--test", ".swarm-acceptance/upper-bound.test.mjs"],
          severity: "required",
          applicable: true,
          referenceDigest: digestOfBytes(reference),
          violatingControlDigest: digestOfBytes(patch),
        },
      ],
    };
    const path = join(root, "acceptance.json");
    await writeFile(
      path,
      JSON.stringify({
        contract,
        artifacts: { [digest]: artifact },
        patches: { [digestOfBytes(reference)]: reference, [digestOfBytes(patch)]: patch },
      }),
    );
    const acceptance = await acceptancePackageExecutor(path, {
      repositoryRoot: repository,
      baseCommit: "HEAD",
      candidatePatch: patch,
      evidence,
      preparationCommands: commands,
      commands: async () => commands,
      timeoutMs: 10_000,
    });
    const verification = await verifyIndependently({
      repositoryRoot: repository,
      baseCommit: "HEAD",
      patch,
      commands,
      clock,
      acceptance,
    });
    expect(verification.regression).toBe("pass");
    expect(verification.acceptance?.obligations[0]?.status).toBe("rejected");
    expect(verification.verified).toBe(false);
    expect(verification.certificationPolicy).toBe("required-obligations-v1");
    await evidence.record({
      type: "independent-verification",
      actor: "harness",
      provenance: ["tool-output"],
      payload: JSON.parse(JSON.stringify(verification)),
    });
    const { bundleSourceFromRecorder, exportBundle } = await import("../evidence/bundle.ts");
    const { createEphemeralSigningKey } = await import("../evidence/signing.ts");
    const { verifyBundleAt } = await import("../evidence/verify-report.ts");
    const bundle = join(root, "bundle");
    await exportBundle({
      source: bundleSourceFromRecorder(evidence),
      destination: bundle,
      signingKey: createEphemeralSigningKey(),
      clock,
    });
    const verified = await verifyBundleAt(bundle, []);
    expect(verified.integrity, verified.lines.join("\n")).toBe("valid");
    expect(verified.lines.join("\n")).toContain("controlled-node-tap-v1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("does not let a passing build certify a configured test runner with no usable results", async () => {
  const result = await verifyIndependently({
    repositoryRoot: repository,
    baseCommit: baseCommit(),
    patch: "",
    commands: commands(),
    clock,
    gateOptions: {
      commandOverrides: {
        tests: {
          command: "node -e \"console.log('{}')\"",
          parser: "structured-test-output",
          severity: "blocking",
        },
        build: { command: 'node -e "process.exit(0)"', parser: "exit-code", severity: "blocking" },
      },
    },
  });
  expect(result.checks.find((check) => check.id === "build")?.status).toBe("passed");
  expect(result.checks.find((check) => check.id === "tests")?.status).toBe("not-applicable");
  expect(result.regression).toBe("unmeasured");
  expect(result.unmeasured).toBe(true);
  expect(result.verified).toBe(false);
});

/**
 * The base control runs in the checkout the patched tree's checks just ran in. git resets the
 * tracked files and removes the untracked ones, and keeps what `.gitignore` names: installed
 * dependencies, and also build output. depose's base typecheck passed on the `dist/` the patched
 * tree's build had written, and a workflow-only patch read "Regression: fail". Each fixture here
 * is a real repository whose checks read ignored output another check or the install wrote.
 */
describe("a base control that sees nothing the patched tree's run produced", () => {
  async function fixture(
    files: Readonly<Record<string, string>>,
    change: Readonly<Record<string, string>>,
  ): Promise<{ readonly base: string; readonly patch: string }> {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(join(repository, path, ".."), { recursive: true });
      await writeFile(join(repository, path), text);
    }
    git(["add", "-A"], repository);
    git(["commit", "-qm", "fixture"], repository);
    const base = baseCommit();
    for (const [path, text] of Object.entries(change)) {
      await mkdir(join(repository, path, ".."), { recursive: true });
      await writeFile(join(repository, path), text);
    }
    git(["add", "-A"], repository);
    const patch = execFileSync("git", ["diff", "--cached", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    });
    git(["reset", "-q", "--hard", base], repository);
    return { base, patch };
  }

  const verify = (base: string, patch: string, installDependencies = false) =>
    verifyIndependently({
      repositoryRoot: repository,
      baseCommit: base,
      patch,
      commands: commands(),
      clock,
      installDependencies,
    });

  // A typecheck that reads what the test step generates, as a project whose `test` script runs
  // a type generator does. Run in the harness's order, the typecheck fails on either tree.
  const generatedTypes = {
    ".gitignore": "generated/\n",
    "package.json":
      '{"name":"w","version":"1.0.0","type":"module","scripts":{"typecheck":"node typecheck.mjs","test":"node gen.mjs && node --test"}}\n',
    "gen.mjs":
      'import { mkdirSync, writeFileSync } from "node:fs";\nmkdirSync("generated", { recursive: true });\nwriteFileSync("generated/types.d.ts", "export type Id = string;\\n");\n',
    "typecheck.mjs":
      'import { existsSync } from "node:fs";\nif (!existsSync("generated/types.d.ts")) { console.error("error TS2307: Cannot find module \'./generated/types\'"); process.exit(2); }\n',
  };

  it("does not let the patched tree's generated output pass the base's typecheck", async () => {
    const { base, patch } = await fixture(generatedTypes, {
      ".github/workflows/verify.yml": "on: pull_request\n",
    });
    const result = await verify(base, patch);
    const typecheck = result.checks.find((check) => check.id === "typecheck");
    expect(typecheck?.status).toBe("failed");
    expect(typecheck?.baseObservation?.exitCode).toBe(2);
    expect(typecheck?.attribution).toBe("inherited");
    expect(result.regression).toBe("pass");
  }, 180_000);

  it("still calls a typecheck the patch broke a regression", async () => {
    const { base, patch } = await fixture(
      { ...generatedTypes, "typecheck.mjs": "\n" },
      {
        "typecheck.mjs":
          'console.error("error TS2322: Type number is not assignable");\nprocess.exit(2);\n',
      },
    );
    const result = await verify(base, patch);
    expect(result.checks.find((check) => check.id === "typecheck")?.attribution).toBe("new");
    expect(result.regression).toBe("fail");
  }, 180_000);

  // A build that emits every source module, and a suite that loads every module the build
  // emitted, as a plugin directory or a route table does.
  const emittedModules = {
    ".gitignore": "dist/\n",
    "package.json":
      '{"name":"w","version":"1.0.0","type":"module","scripts":{"build":"node build.mjs","test":"node --test"}}\n',
    "build.mjs":
      'import { copyFileSync, mkdirSync, readdirSync } from "node:fs";\nmkdirSync("dist", { recursive: true });\nfor (const name of readdirSync("src")) copyFileSync("src/" + name, "dist/" + name);\n',
    "src/a.mjs": "export const ok = true;\n",
    "modules.test.mjs": [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { readdirSync } from 'node:fs';",
      "for (const name of readdirSync(new URL('./dist/', import.meta.url)).sort())",
      "  test(name, async () => assert.equal((await import('./dist/' + name)).ok, true));",
      "",
    ].join("\n"),
  };

  it("does not read a module only the patched build emitted as a failure the base shares", async () => {
    const { base, patch } = await fixture(emittedModules, {
      "src/b.mjs": "export const ok = false;\n",
    });
    const result = await verify(base, patch);
    const tests = result.checks.find((check) => check.id === "tests");
    expect(tests?.status).toBe("failed");
    expect(tests?.attribution).toBe("new");
    expect(result.regression).toBe("fail");
  }, 180_000);

  it("reads a build failure the base shares as inherited, and a typecheck of its output as passing", async () => {
    // depose's shape: the build writes its declarations and then fails on a tool the image lacks.
    const { base, patch } = await fixture(
      {
        ".gitignore": "dist/\n",
        "package.json":
          '{"name":"w","version":"1.0.0","type":"module","scripts":{"build":"node build.mjs","typecheck":"node typecheck.mjs","test":"node --test"}}\n',
        "build.mjs":
          'import { mkdirSync, writeFileSync } from "node:fs";\nmkdirSync("dist", { recursive: true });\nwriteFileSync("dist/index.d.ts", "export declare const clamp: (v: number) => number;\\n");\nconsole.error("/bin/sh: 1: go: not found");\nprocess.exit(2);\n',
        "typecheck.mjs":
          'import { existsSync } from "node:fs";\nif (!existsSync("dist/index.d.ts")) { console.error("error TS2307"); process.exit(2); }\n',
      },
      { ".github/workflows/verify.yml": "on: pull_request\n" },
    );
    const result = await verify(base, patch);
    expect(result.checks.find((check) => check.id === "build")?.attribution).toBe("inherited");
    expect(result.checks.find((check) => check.id === "typecheck")?.status).toBe("passed");
    expect(result.regression).toBe("pass");
  }, 180_000);

  it("installs the base's own dependencies where the patch changes the lockfile", async () => {
    const lock = (version: number) =>
      `${JSON.stringify(
        {
          name: "w",
          version: "1.0.0",
          lockfileVersion: 3,
          requires: true,
          packages: {
            "": {
              name: "w",
              version: "1.0.0",
              dependencies: { dep: `file:vendor/dep-${version}` },
            },
            "node_modules/dep": { resolved: `vendor/dep-${version}`, link: true },
            [`vendor/dep-${version}`]: { name: "dep", version: `${version}.0.0` },
          },
        },
        null,
        2,
      )}\n`;
    const manifest = (version: number) =>
      `{"name":"w","version":"1.0.0","type":"module","scripts":{"lint":"node -e 0","test":"node --test"},"dependencies":{"dep":"file:vendor/dep-${version}"}}\n`;
    const { base, patch } = await fixture(
      {
        ".gitignore": "node_modules/\n",
        "package.json": manifest(1),
        "package-lock.json": lock(1),
        "vendor/dep-1/package.json": '{"name":"dep","version":"1.0.0","main":"index.js"}\n',
        "vendor/dep-1/index.js": "module.exports = 1;\n",
        "vendor/dep-2/package.json": '{"name":"dep","version":"2.0.0","main":"index.js"}\n',
        "vendor/dep-2/index.js": "module.exports = 2;\n",
        "dep.test.mjs":
          "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport dep from 'dep';\ntest('dep', () => assert.equal(dep, 1));\n",
      },
      { "package.json": manifest(2), "package-lock.json": lock(2) },
    );
    const result = await verify(base, patch, true);
    expect(result.install?.succeeded).toBe(true);
    const tests = result.checks.find((check) => check.id === "tests");
    expect(tests?.status).toBe("failed");
    // Measured beside the patch's dependencies the base fails the same way, and the upgrade that
    // broke the suite read as inherited.
    expect(tests?.attribution).toBe("new");
    expect(result.regression).toBe("fail");
  }, 300_000);
});
