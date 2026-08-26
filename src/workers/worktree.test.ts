import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addWorktree,
  headCommit,
  mergeBranch,
  resetHard,
  sweepRunBranches,
  type Worktree,
} from "./worktree.ts";

const run = promisify(execFile);

let repository = "";
let scratch = "";

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd });
  return stdout;
}

async function write(root: string, path: string, contents: string): Promise<void> {
  await writeFile(join(root, path), contents, "utf8");
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-worktree-"));
  repository = join(scratch, "repo");
  await run("git", ["init", "--quiet", repository]);
  await git(repository, "config", "user.email", "workers@example.com");
  await git(repository, "config", "user.name", "workers");
  await write(repository, "shared.txt", "base\n");
  await git(repository, "add", ".");
  await git(repository, "commit", "--quiet", "-m", "seed");
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function worktreeAt(name: string): Promise<Worktree> {
  return addWorktree({
    repositoryRoot: repository,
    path: join(scratch, name),
    branch: `swarm/${name}`,
    baseRef: "HEAD",
  });
}

describe("addWorktree", () => {
  it("checks the base out on a new branch of its own", async () => {
    const worktree = await worktreeAt("one");

    expect(await readFile(join(worktree.path, "shared.txt"), "utf8")).toBe("base\n");
    expect((await git(worktree.path, "rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe(
      "swarm/one",
    );
  });

  it("gives each worker a working copy nothing else can see", async () => {
    const one = await worktreeAt("one");
    const two = await worktreeAt("two");

    await write(one.path, "shared.txt", "changed by one\n");

    expect(await readFile(join(two.path, "shared.txt"), "utf8")).toBe("base\n");
    expect(await readFile(join(repository, "shared.txt"), "utf8")).toBe("base\n");
  });

  it("refuses a second worktree on the same branch, which git would not allow anyway", async () => {
    await worktreeAt("one");

    await expect(
      addWorktree({
        repositoryRoot: repository,
        path: join(scratch, "one-again"),
        branch: "swarm/one",
        baseRef: "HEAD",
      }),
    ).rejects.toThrow(/swarm\/one/);
  });
});

describe("committing a worker's result", () => {
  it("commits everything in the tree, new files included", async () => {
    const worktree = await worktreeAt("one");
    await write(worktree.path, "shared.txt", "changed\n");
    await write(worktree.path, "added.txt", "new\n");

    const commit = await worktree.commitAll("worker one");

    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    expect(await git(worktree.path, "show", "--name-only", "--format=", "HEAD")).toContain(
      "added.txt",
    );
  });

  it("reports nothing rather than an empty commit when the worker changed nothing", async () => {
    const worktree = await worktreeAt("one");

    expect(await worktree.commitAll("worker one")).toBeNull();
  });

  it("leaves the branch behind when the worktree is removed", async () => {
    const worktree = await worktreeAt("one");
    await write(worktree.path, "shared.txt", "changed\n");
    await worktree.commitAll("worker one");

    await worktree.remove();

    expect(await git(repository, "branch", "--list", "swarm/one")).toContain("swarm/one");
  });
});

/** A finished worker: a branch carrying one commit, with its working copy already gone. */
async function branchWith(name: string, path: string, contents: string): Promise<string> {
  const worktree = await worktreeAt(name);
  await write(worktree.path, path, contents);
  await worktree.commitAll(`work on ${name}`);
  await worktree.remove();
  return worktree.branch;
}

describe("mergeBranch", () => {
  it("merges work that touches a different file", async () => {
    const integration = await worktreeAt("integration");
    const branch = await branchWith("one", "one.txt", "from one\n");

    const outcome = await mergeBranch(integration.path, branch, "land one");

    expect(outcome.merged).toBe(true);
    expect(await readFile(join(integration.path, "one.txt"), "utf8")).toBe("from one\n");
  });

  it("reports the conflict and leaves the tree exactly where it was", async () => {
    const integration = await worktreeAt("integration");
    const first = await branchWith("one", "shared.txt", "from one\n");
    const second = await branchWith("two", "shared.txt", "from two\n");
    await mergeBranch(integration.path, first, "land one");
    const before = await headCommit(integration.path);

    const outcome = await mergeBranch(integration.path, second, "land two");

    expect(outcome.merged).toBe(false);
    expect(outcome.output).toMatch(/shared\.txt/);
    expect(await headCommit(integration.path)).toBe(before);
    // No half-merged state left behind: the next merge starts from a clean tree.
    expect((await git(integration.path, "status", "--porcelain")).trim()).toBe("");
  });

  it("names the branch and the conflicting paths, so a worker is told what to do", async () => {
    const integration = await worktreeAt("integration");
    await mergeBranch(
      integration.path,
      await branchWith("one", "shared.txt", "from one\n"),
      "land one",
    );

    const outcome = await mergeBranch(
      integration.path,
      await branchWith("two", "shared.txt", "from two\n"),
      "land two",
    );

    expect(outcome.conflictingPaths).toEqual(["shared.txt"]);
  });
});

describe("resetHard", () => {
  it("puts a worktree back on a commit, discarding what came after", async () => {
    const integration = await worktreeAt("integration");
    const before = await headCommit(integration.path);
    await mergeBranch(
      integration.path,
      await branchWith("one", "one.txt", "from one\n"),
      "land one",
    );

    await resetHard(integration.path, before);

    expect(await headCommit(integration.path)).toBe(before);
    expect((await git(integration.path, "status", "--porcelain")).trim()).toBe("");
  });
});

describe("sweeping up after a run", () => {
  async function branchesIn(root: string): Promise<readonly string[]> {
    const out = await git(root, "branch", "--format=%(refname:short)");
    return out
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  it("removes the run's branches and leaves everything else alone", async () => {
    const one = await addWorktree({
      repositoryRoot: repository,
      path: join(scratch, "w1"),
      branch: "swarm/run1/worker-1",
      baseRef: "HEAD",
    });
    await addWorktree({
      repositoryRoot: repository,
      path: join(scratch, "w2"),
      branch: "swarm/run2/worker-1",
      baseRef: "HEAD",
    });
    await one.remove();

    const removed = await sweepRunBranches(repository, "run1");

    expect(removed).toEqual(["swarm/run1/worker-1"]);
    const left = await branchesIn(repository);
    expect(left).toContain("swarm/run2/worker-1");
    expect(left).not.toContain("swarm/run1/worker-1");
  });

  it("keeps a branch whose worktree is still checked out, rather than failing", async () => {
    await addWorktree({
      repositoryRoot: repository,
      path: join(scratch, "held"),
      branch: "swarm/run1/worker-1",
      baseRef: "HEAD",
    });

    const removed = await sweepRunBranches(repository, "run1");

    expect(removed).toEqual([]);
    expect(await branchesIn(repository)).toContain("swarm/run1/worker-1");
  });

  it("prunes worktree registrations a killed run left behind", async () => {
    const abandoned = await addWorktree({
      repositoryRoot: repository,
      path: join(scratch, "gone"),
      branch: "swarm/run1/worker-1",
      baseRef: "HEAD",
    });
    // What a killed run leaves: the directory gone, the registration still there.
    await rm(abandoned.path, { recursive: true, force: true });

    await sweepRunBranches(repository, "run1");

    expect(await git(repository, "worktree", "list")).not.toContain("gone");
  });

  it("sweeps nothing when the run created nothing", async () => {
    expect(await sweepRunBranches(repository, "run-that-never-ran")).toEqual([]);
  });
});
