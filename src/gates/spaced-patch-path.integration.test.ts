import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { verifyIndependently } from "./independent-verification.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";

/**
 * A patch git wrote for a file whose name holds a space, applied to a fresh checkout and measured
 * there. Its header is `diff --git a/my file.js b/my file.js`, which the path readers once refused
 * or split at the first space.
 */
let repository = "";
const clock = { now: () => 0, sleep: () => Promise.resolve() };
const commands = () => createNodeCommandRunner(clock, harnessChildEnvironment());

function git(...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=fixture", "-c", "user.email=fixture@example.test", ...args],
    { cwd: repository, encoding: "utf8" },
  );
}

beforeEach(async () => {
  repository = await mkdtemp(join(tmpdir(), "swarm-spaced-path-"));
  git("init", "-q");
  await writeFile(
    join(repository, "package.json"),
    '{"name":"w","version":"1.0.0","type":"module","scripts":{"test":"node --test"}}\n',
  );
  await writeFile(join(repository, "my file.js"), "export const double = (v) => v * 2;\n");
  await writeFile(
    join(repository, "double.test.js"),
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { double } from './my file.js';\ntest('doubles', () => assert.equal(double(3), 6));\n",
  );
  git("add", "-A");
  git("commit", "-qm", "base");
});

afterEach(async () => {
  await rm(repository, { recursive: true, force: true });
});

/** The patch git writes for a new body of `my file.js`, with the worktree restored after. */
async function patchFor(body: string): Promise<string> {
  await writeFile(join(repository, "my file.js"), body);
  const patch = git("diff", "HEAD");
  git("checkout", "--", "my file.js");
  expect(patch).toContain("diff --git a/my file.js b/my file.js\n");
  expect(patch).toContain("+++ b/my file.js\t\n");
  return patch;
}

function verify(patch: string, immutablePaths?: readonly string[]) {
  return verifyIndependently({
    repositoryRoot: repository,
    baseCommit: git("rev-parse", "HEAD").trim(),
    patch,
    commands: commands(),
    clock,
    ...(immutablePaths === undefined ? {} : { immutablePaths }),
  });
}

it("applies and measures a git patch to a path holding a space", async () => {
  const result = await verify(await patchFor("export const double = (v) => v + v;\n"));
  expect(result.refusal).toBeNull();
  expect(result.applied).toBe(true);
  expect(result.checks.find((check) => check.id === "tests")?.status).toBe("passed");
  expect(result.regression).toBe("pass");
}, 180_000);

it("fails the same path when the change breaks it", async () => {
  const result = await verify(await patchFor("export const double = (v) => v * 3;\n"));
  expect(result.applied).toBe(true);
  expect(result.checks.find((check) => check.id === "tests")?.status).toBe("failed");
  expect(result.regression).toBe("fail");
  expect(result.verified).toBe(false);
}, 180_000);

it("refuses the patch before running anything when the spaced path is immutable", async () => {
  const result = await verify(await patchFor("export const double = (v) => v + v;\n"), [
    "my file.js",
  ]);
  expect(result.applied).toBe(false);
  expect(result.refusal).toContain("my file.js");
});
