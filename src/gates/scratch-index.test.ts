import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGitWorkspaceProbe } from "./git-workspace.ts";
import { recordTurnBaseline } from "./turn-baseline.ts";

const run = promisify(execFile);

let workspace = "";

async function git(...args: readonly string[]): Promise<string> {
  const { stdout } = await run("git", [...args], { cwd: workspace });
  return stdout.trim();
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "swarm-scratch-test-"));
  await git("init", "-q");
  await git("config", "user.email", "test@localhost");
  await git("config", "user.name", "test");
  await writeFile(join(workspace, "seed.txt"), "seed\n");
  await git("add", "-A");
  await git("commit", "-q", "-m", "first");
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("what the gates see across two turns of a session", () => {
  /**
   * The defect this covers, found by running a two-turn session and reading one number: the
   * second turn reported `2 file(s) and 0 added line(s)` for a turn that had written a test.
   *
   * The first turn's files are untracked, and they are in the baseline commit the second turn
   * measures against, so `git diff <baseline>` from the person's own index called them
   * *deleted*. The untracked pass then skipped them, because the deletion had already claimed
   * the path. The second turn's real work was invisible and its deletions were the measurement.
   */
  it("counts the second turn's own edits, not the first turn's files as deletions", async () => {
    await writeFile(join(workspace, "calculator.js"), "function add(a, b) {\n  return a + b;\n}\n");
    const baseline = await recordTurnBaseline({
      workspaceRoot: workspace,
      label: "turn 1",
      previousBase: "HEAD",
    });
    expect(baseline).not.toBeNull();

    // Turn two edits what turn one wrote, the way a follow-up task does.
    await writeFile(
      join(workspace, "calculator.js"),
      "function add(a, b) {\n  return a + b;\n}\n\nfunction divide(a, b) {\n  return a / b;\n}\n",
    );

    const changes = await createGitWorkspaceProbe({
      workspaceRoot: workspace,
      baseRef: baseline ?? "HEAD",
    }).changes();

    expect(changes.files.map((file) => file.path)).toEqual(["calculator.js"]);
    const [only] = changes.files;
    expect(only?.kind).not.toBe("deleted");
    expect(only?.addedLines.length ?? 0).toBeGreaterThan(0);
  });

  it("sees a file the turn created and nothing else", async () => {
    await writeFile(join(workspace, "fresh.js"), "export const a = 1;\n");

    const changes = await createGitWorkspaceProbe({
      workspaceRoot: workspace,
      baseRef: "HEAD",
    }).changes();

    expect(changes.files.map((file) => file.path)).toEqual(["fresh.js"]);
    expect(changes.files[0]?.kind).toBe("added");
  });

  it("still reports a genuine deletion as one", async () => {
    await rm(join(workspace, "seed.txt"));

    const changes = await createGitWorkspaceProbe({
      workspaceRoot: workspace,
      baseRef: "HEAD",
    }).changes();

    expect(changes.files.map((file) => file.path)).toEqual(["seed.txt"]);
    expect(changes.files[0]?.kind).toBe("deleted");
  });

  it("leaves an ignored file out, since the person said not to look at it", async () => {
    await writeFile(join(workspace, ".gitignore"), "secrets/\n");
    await git("add", "-A");
    await git("commit", "-q", "-m", "ignore");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(workspace, "secrets"), { recursive: true });
    await writeFile(join(workspace, "secrets", "key.txt"), "shhh\n");

    const changes = await createGitWorkspaceProbe({
      workspaceRoot: workspace,
      baseRef: "HEAD",
    }).changes();

    expect(changes.files).toEqual([]);
  });

  it("reports nothing when the turn changed nothing", async () => {
    const changes = await createGitWorkspaceProbe({
      workspaceRoot: workspace,
      baseRef: "HEAD",
    }).changes();

    expect(changes.files).toEqual([]);
  });
});

describe("what running the tests leaves behind", () => {
  /**
   * The defect this covers, found by running a Python task: the model's own test run wrote
   * `__pycache__/scraper.cpython-314.pyc`, the file-set gate charged it as an edit outside the
   * declared set, and the ratchet then rejected the attempt for a gate that had passed before,
   * discarding the work. An interpreter cache is written by running the code, not by anyone
   * editing it, and no author declares one.
   */
  it("does not count an interpreter cache as a change", async () => {
    await writeFile(join(workspace, "scraper.py"), "print('hi')\n");
    await mkdir(join(workspace, "__pycache__"), { recursive: true });
    await writeFile(join(workspace, "__pycache__", "scraper.cpython-314.pyc"), "bytecode");
    await mkdir(join(workspace, ".pytest_cache", "v", "cache"), { recursive: true });
    await writeFile(join(workspace, ".pytest_cache", "v", "cache", "nodeids"), "[]");

    const changes = await createGitWorkspaceProbe({
      workspaceRoot: workspace,
      baseRef: "HEAD",
    }).changes();

    expect(changes.files.map((file) => file.path)).toEqual(["scraper.py"]);
  });
});
