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
    expect(result.verified).toBe(true);
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
