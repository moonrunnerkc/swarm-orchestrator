import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { capturedRegression } from "../evidence/verifier/status.mjs";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { verifyIndependently } from "./independent-verification.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";

/**
 * Attack families run against real runners in real repositories through `ci`, each beside a
 * valid counterpart that must keep passing. Family 1: a patch that breaks the code and edits the
 * test that would catch it (skipped, deleted, or its assertion replaced) read as a regression
 * pass through 1.0.7, because the suite the patch shipped passed. Families 4 and 5: an all-skipped
 * real suite and a real run whose output exceeds what the record keeps.
 */
let repository = "";
const clock = { now: () => 0, sleep: () => Promise.resolve() };

function git(args: readonly string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd: repository,
    encoding: "utf8",
  }).trim();
}

const nodeTests = [
  'import test from "node:test";',
  'import assert from "node:assert/strict";',
  'import { double } from "./calc.mjs";',
  'test("doubles", () => { assert.equal(double(2), 4); });',
  'test("doubles zero", () => { assert.equal(double(0), 0); });',
  "",
].join("\n");

beforeEach(async () => {
  repository = await mkdtemp(join(tmpdir(), "swarm-attack-families-"));
  git(["init", "-q"]);
  await writeFile(
    join(repository, "package.json"),
    '{"name":"w","private":true,"type":"module","scripts":{"test":"node --test"}}\n',
  );
  await writeFile(join(repository, "calc.mjs"), "export const double = (n) => n * 2;\n");
  await writeFile(join(repository, "calc.test.mjs"), nodeTests);
  git(["add", "-A"]);
  git(["commit", "-qm", "base"]);
});

afterEach(async () => {
  await rm(repository, { recursive: true, force: true });
});

/** The patch that turns the working tree's edits into a candidate, then the tree put back. */
async function candidate(files: Readonly<Record<string, string | null>>) {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) await rm(join(repository, path));
    else await writeFile(join(repository, path), content);
  }
  git(["add", "-A"]);
  const patch = git(["diff", "--cached"]);
  git(["reset", "-q", "--hard"]);
  const result = await verifyIndependently({
    repositoryRoot: repository,
    baseCommit: git(["rev-parse", "HEAD"]),
    patch: `${patch}\n`,
    commands: createNodeCommandRunner(clock, harnessChildEnvironment()),
    clock,
  });
  // The offline verifier, a second implementation, must read the same regression from the record.
  expect(capturedRegression(result.checks)).toBe(result.regression);
  return { result, tests: result.checks.find((one) => one.id === "tests") };
}

const broken = "export const double = (n) => n * 3;\n";

describe("family 1: a patch edits the test that would catch it", () => {
  it("does not pass a broken change behind a skipped test, and names the test", async () => {
    const { result, tests } = await candidate({
      "calc.mjs": broken,
      "calc.test.mjs": nodeTests.replace('test("doubles",', 'test.skip("doubles",'),
    });
    expect(result.regression).toBe("unmeasured");
    expect(result.verified).toBe(false);
    expect(tests?.status).toBe("not-applicable");
    expect(tests?.weakenedTests).toEqual(["calc.test.mjs:4:1 › 0:doubles"]);
  }, 120_000);

  it("does not pass a broken change behind a deleted test file or a replaced assertion", async () => {
    const deleted = await candidate({ "calc.mjs": broken, "calc.test.mjs": null });
    expect(deleted.result.regression).toBe("unmeasured");
    expect(deleted.tests?.baseTestsFiles).toEqual(["calc.test.mjs"]);
    const replaced = await candidate({
      "calc.mjs": broken,
      "calc.test.mjs": nodeTests.replace("assert.equal(double(2), 4)", "assert.ok(true)"),
    });
    expect(replaced.result.regression).toBe("unmeasured");
    expect(replaced.tests?.weakenedTests).toEqual(["calc.test.mjs:4:1 › 0:doubles"]);
  }, 180_000);

  it("keeps passing a correct change that also edits, renames or adds tests", async () => {
    const { result, tests } = await candidate({
      "calc.mjs": "export const double = (n) => n + n;\n",
      "calc.test.mjs": nodeTests
        .replace('test("doubles zero"', 'test("doubles nothing to zero"')
        .concat('test("doubles negatives", () => { assert.equal(double(-2), -4); });\n'),
    });
    expect(tests?.baseTestsStatus).toBe("passed");
    expect(tests?.status).toBe("passed");
    expect(result.regression).toBe("pass");
  }, 120_000);
});

describe("family 4: a real suite with nothing executed", () => {
  it("does not pass a patch that skips every test", async () => {
    const { result, tests } = await candidate({
      "calc.test.mjs": nodeTests.replaceAll("test(", "test.skip("),
    });
    expect(tests?.status).not.toBe("passed");
    expect(result.regression).not.toBe("pass");
  }, 120_000);
});

describe("family 5: a real run whose output exceeds what the record keeps", () => {
  it("reads the exit status, not a successful-looking prefix, and never inherits across the cut", async () => {
    await writeFile(
      join(repository, "noisy.test.mjs"),
      'import test from "node:test";\ntest("prints", () => { for (let i = 0; i < 6000; i++) console.log("ok " + i + " - looks fine ".repeat(8)); });\n',
    );
    await writeFile(
      join(repository, "late.test.mjs"),
      'import test from "node:test";\nimport assert from "node:assert/strict";\ntest("late", () => assert.equal(1, 2));\n',
    );
    git(["add", "-A"]);
    git(["commit", "-qm", "a loud suite with a known failure"]);
    const { result, tests } = await candidate({ "calc.mjs": broken });
    expect(tests?.status).toBe("failed");
    expect(tests?.attribution).not.toBe("inherited");
    expect(result.regression).not.toBe("pass");
  }, 180_000);
});

describe("family 3: a runner reached through a substituted executable", () => {
  it("does not pass a vitest reached through a node_modules/.bin link the lockfile's package does not own", async () => {
    await writeFile(
      join(repository, "package.json"),
      '{"name":"w","private":true,"type":"module","scripts":{"test":"vitest run --passWithNoTests --silent"}}\n',
    );
    await writeFile(
      join(repository, "calc.test.mjs"),
      'import { expect, test } from "vitest";\nimport { double } from "./calc.mjs";\ntest("doubles", () => expect(double(2)).toBe(4));\n',
    );
    git(["add", "-A"]);
    git(["commit", "-qm", "a vitest suite"]);
    // The checkout's dependencies: this repository's real ones, except that `.bin/vitest` is a
    // script printing a passing summary. The link is committed, so the fresh checkout has it.
    const modules = await mkdtemp(join(tmpdir(), "swarm-substituted-modules-"));
    await mkdir(join(modules, ".bin"));
    for (const name of await readdir(resolve("node_modules")))
      if (name !== ".bin") await symlink(resolve("node_modules", name), join(modules, name));
    await writeFile(
      join(modules, ".bin", "vitest"),
      '#!/bin/sh\necho " Test Files  1 passed (1)"\necho "      Tests  1 passed (1)"\nexit 0\n',
      { mode: 0o755 },
    );
    await symlink(modules, join(repository, "node_modules"));
    git(["add", "-A"]);
    git(["commit", "-qm", "dependencies as installed"]);
    const { result, tests } = await candidate({ "calc.mjs": broken });
    expect(tests?.status).not.toBe("passed");
    expect(result.regression).not.toBe("pass");
    await rm(modules, { recursive: true, force: true });
  }, 180_000);

  it("does not pass a script run through an interpreter a node_modules/.bin link shadows", async () => {
    await writeFile(
      join(repository, "package.json"),
      '{"name":"w","private":true,"type":"module","scripts":{"test":"node --test && node -e 0"}}\n',
    );
    const modules = await mkdtemp(join(tmpdir(), "swarm-shadowed-node-"));
    await mkdir(join(modules, ".bin"));
    await writeFile(
      join(modules, ".bin", "node"),
      "#!/bin/sh\necho '# tests 2'\necho '# pass 2'\nexit 0\n",
      {
        mode: 0o755,
      },
    );
    await symlink(modules, join(repository, "node_modules"));
    git(["add", "-A"]);
    git(["commit", "-qm", "dependencies as installed"]);
    const { result, tests } = await candidate({ "calc.mjs": broken });
    expect(tests?.status).not.toBe("passed");
    expect(result.regression).not.toBe("pass");
    await rm(modules, { recursive: true, force: true });
  }, 120_000);
});
