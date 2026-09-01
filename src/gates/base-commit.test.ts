import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGitWorkspaceProbe, resolveBaseCommit } from "./git-workspace.ts";
import { measureTestFile } from "./measures.ts";

const run = promisify(execFile);

/**
 * What the gates are measured against has to be decided once, by the harness, before the run
 * starts.
 *
 * `HEAD` is a symbolic ref, and every base-side question spends it when it is asked. `git` is
 * on the default shell allowlist, so one unconfirmed tool call moves it, and the base of every
 * measurement moves with it: the deletion the ratchet exists to catch stops being a deletion,
 * and the change set the diff budget, the file-set check and changed-line coverage read goes
 * empty.
 */

let repository = "";

const threeTests = [
  "import { test } from 'node:test';",
  "test('one', () => {});",
  "test('two', () => {});",
  "test('three', () => {});",
  "",
].join("\n");

const oneTest = ["import { test } from 'node:test';", "test('one', () => {});", ""].join("\n");

beforeEach(async () => {
  repository = await mkdtemp(join(tmpdir(), "swarm-base-commit-"));
  await run("git", ["init", "--quiet", repository]);
  await run("git", ["config", "user.email", "base@example.com"], { cwd: repository });
  await run("git", ["config", "user.name", "base"], { cwd: repository });
  await writeFile(join(repository, "a.test.mjs"), threeTests);
  await run("git", ["add", "."], { cwd: repository });
  await run("git", ["commit", "--quiet", "-m", "seed"], { cwd: repository });
  // What the run is measuring: two of the three tests gone from the working tree.
  await writeFile(join(repository, "a.test.mjs"), oneTest);
});

afterEach(async () => {
  await rm(repository, { recursive: true, force: true });
});

async function commitEverything(): Promise<void> {
  await run("git", ["add", "-A"], { cwd: repository });
  await run("git", ["commit", "--quiet", "-m", "wip"], { cwd: repository });
}

describe("resolveBaseCommit", () => {
  it("answers with the commit a name points at", async () => {
    const resolved = await resolveBaseCommit(repository, "HEAD");

    expect(resolved).toMatch(/^[0-9a-f]{40}$/);
  });

  it("answers the same commit whatever name reached it", async () => {
    const head = await resolveBaseCommit(repository, "HEAD");
    const branch = await resolveBaseCommit(
      repository,
      (await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repository })).stdout.trim(),
    );

    expect(branch).toBe(head);
  });

  it("hands back the name where it does not resolve, so the good error is still raised later", async () => {
    const empty = await mkdtemp(join(tmpdir(), "swarm-not-a-repo-"));
    await mkdir(join(empty, "sub"), { recursive: true });

    expect(await resolveBaseCommit(empty, "HEAD")).toBe("HEAD");

    await rm(empty, { recursive: true, force: true });
  });
});

describe("a commit made inside the run", () => {
  it("moves the base out from under an unresolved ref", async () => {
    // The defect, stated as the test that would have caught it. Kept as a demonstration
    // rather than deleted: it is what makes the case below mean something.
    const probe = createGitWorkspaceProbe({ workspaceRoot: repository, baseRef: "HEAD" });
    const before = measureTestFile(await probe.readBase("a.test.mjs"));
    const changedBefore = (await probe.changes()).files.length;

    await commitEverything();

    expect(before.tests).toBe(3);
    expect(changedBefore).toBe(1);
    expect(measureTestFile(await probe.readBase("a.test.mjs")).tests).toBe(1);
    expect((await probe.changes()).files).toHaveLength(0);
  });

  it("moves nothing once the base was resolved before the run started", async () => {
    const probe = createGitWorkspaceProbe({
      workspaceRoot: repository,
      baseRef: await resolveBaseCommit(repository, "HEAD"),
    });
    const before = measureTestFile(await probe.readBase("a.test.mjs"));

    await commitEverything();

    // The deletion is still a deletion, and the change set still holds the file it changed.
    expect(before.tests).toBe(3);
    expect(measureTestFile(await probe.readBase("a.test.mjs")).tests).toBe(3);
    expect((await probe.changes()).files.map((file) => file.path)).toEqual(["a.test.mjs"]);
  });

  it("cannot hide the deletion behind several commits either", async () => {
    const probe = createGitWorkspaceProbe({
      workspaceRoot: repository,
      baseRef: await resolveBaseCommit(repository, "HEAD"),
    });

    await commitEverything();
    await writeFile(join(repository, "b.mjs"), "export const b = 1;\n");
    await commitEverything();

    expect(measureTestFile(await probe.readBase("a.test.mjs")).tests).toBe(3);
    expect((await probe.changes()).files.map((file) => file.path).sort()).toEqual([
      "a.test.mjs",
      "b.mjs",
    ]);
  });
});
