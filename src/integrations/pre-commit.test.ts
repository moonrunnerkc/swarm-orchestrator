import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hookMarker, installPreCommit, uninstallPreCommit, verifyStaged } from "./pre-commit.ts";

const run = promisify(execFile);

/**
 * The staged tree and nothing else: a good change staged beside a bad one left unstaged passes,
 * a bad change staged fails, the working tree is never touched, and the git hook is installed
 * without displacing one that is already there.
 */
let scratch = "";
let repository = "";
const entry = resolve("src/swarm-verify.ts");

async function git(args: readonly string[]): Promise<string> {
  const ran = await run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd: repository,
  });
  return ran.stdout.trim();
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-precommit-"));
  repository = join(scratch, "repo");
  await mkdir(repository);
  await git(["init", "-q"]);
  await writeFile(
    join(repository, "package.json"),
    '{ "name": "w", "version": "1.0.0", "type": "module", "scripts": { "test": "node --test" } }\n',
  );
  await writeFile(join(repository, "double.mjs"), "export const double = (n) => n + n;\n");
  await writeFile(
    join(repository, "double.test.mjs"),
    'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { double } from "./double.mjs";\ntest("doubles", () => assert.equal(double(2), 4));\n',
  );
  await git(["add", "-A"]);
  await git(["commit", "-qm", "base"]);
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const options = () => ({ repository, entry, json: false, home: join(scratch, "home") });

describe("verifying the staged tree", () => {
  it("says so and exits 0 when nothing is staged", async () => {
    const outcome = await verifyStaged(options());
    expect(outcome.exitCode).toBe(0);
    expect(outcome.lines[0]).toContain("nothing is staged");
  });

  it("passes a good staged change while a breaking unstaged edit sits in the working tree, and leaves both alone", async () => {
    await writeFile(join(repository, "double.mjs"), "export const double = (n) => n * 2;\n");
    await git(["add", "double.mjs"]);
    // Unstaged after staging: the working tree now breaks the test, the index does not.
    await writeFile(join(repository, "double.mjs"), "export const double = (n) => n * 3;\n");
    await writeFile(join(repository, "untracked.txt"), "left alone\n");
    const outcome = await verifyStaged(options());
    expect(outcome.exitCode).toBe(0);
    expect(outcome.lines.join("\n")).toMatch(/staged tree [0-9a-f]{40}/);
    expect(outcome.lines.join("\n")).toContain("result       regression-only pass");
    expect(await readFile(join(repository, "double.mjs"), "utf8")).toBe(
      "export const double = (n) => n * 3;\n",
    );
    expect(await readFile(join(repository, "untracked.txt"), "utf8")).toBe("left alone\n");
    expect(await git(["status", "--porcelain"])).toContain("untracked.txt");
    expect(await git(["worktree", "list"])).not.toContain("staged");
  }, 120_000);

  it("fails a staged change the suite refuses", async () => {
    await writeFile(join(repository, "double.mjs"), "export const double = (n) => n * 3;\n");
    await git(["add", "double.mjs"]);
    const outcome = await verifyStaged(options());
    expect(outcome.exitCode).toBe(1);
    expect(outcome.lines.join("\n")).toContain("failed 1 (tests)");
  }, 120_000);

  it("borrows the working tree's installed dependencies by link and says so", async () => {
    await mkdir(join(repository, "node_modules"));
    await writeFile(join(repository, ".gitignore"), "node_modules\n");
    await writeFile(join(repository, "double.mjs"), "export const double = (n) => n * 2;\n");
    await git(["add", "-A"]);
    const outcome = await verifyStaged(options());
    expect(outcome.lines[1]).toContain("borrowed from the working tree by link: node_modules");
    expect(outcome.exitCode).toBe(0);
  }, 120_000);
});

describe("the git hook", () => {
  it("installs once, is idempotent, and is removed only where it is ours", async () => {
    const first = await installPreCommit(repository, entry);
    expect(first.state).toBe("installed");
    const content = await readFile(first.path, "utf8");
    expect(content).toContain(hookMarker);
    expect(content).toContain("pre-commit");
    expect((await installPreCommit(repository, entry)).state).toBe("present");
    expect((await uninstallPreCommit(repository)).state).toBe("removed");
    expect((await uninstallPreCommit(repository)).state).toBe("absent");
  });

  it("leaves a foreign hook in place and names the line to add", async () => {
    const hooks = await git(["rev-parse", "--git-path", "hooks"]);
    await mkdir(join(repository, hooks), { recursive: true });
    await writeFile(join(repository, hooks, "pre-commit"), "#!/bin/sh\necho theirs\n", {
      mode: 0o755,
    });
    const outcome = await installPreCommit(repository, entry);
    expect(outcome.state).toBe("foreign");
    expect(outcome.line).toContain("pre-commit");
    expect(await readFile(join(repository, hooks, "pre-commit"), "utf8")).toBe(
      "#!/bin/sh\necho theirs\n",
    );
    expect((await uninstallPreCommit(repository)).state).toBe("foreign");
  });

  it("runs on a real commit and blocks the bad one", async () => {
    await installPreCommit(repository, entry);
    await writeFile(join(repository, "double.mjs"), "export const double = (n) => n * 3;\n");
    await git(["add", "double.mjs"]);
    await expect(git(["commit", "-qm", "bad"])).rejects.toThrow();
    expect(await git(["log", "--oneline"])).not.toContain("bad");
    await writeFile(join(repository, "double.mjs"), "export const double = (n) => n * 2;\n");
    await git(["add", "double.mjs"]);
    await git(["commit", "-qm", "good"]);
    expect(await git(["log", "--oneline"])).toContain("good");
  }, 240_000);
});
