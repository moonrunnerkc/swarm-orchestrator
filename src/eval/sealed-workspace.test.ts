import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareSealedWorkspace, WorkspaceHoldsTheOracle } from "./sealed-workspace.ts";

const heldBackTitle = "keeps the global value on a name collision";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repositoryWithAMergedPull() {
  const root = mkdtempSync(join(tmpdir(), "sealed-workspace-"));
  roots.push(root);
  const checkout = join(root, "checkout");
  mkdirSync(checkout);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: checkout, encoding: "utf8" }).trim();
  git("init", "--quiet", "--initial-branch=main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "test");
  writeFileSync(join(checkout, "index.js"), "export const merge = (a, b) => ({ ...a, ...b });\n");
  git("add", "-A");
  git("commit", "--quiet", "-m", "base");
  const baseCommit = git("rev-parse", "HEAD");
  mkdirSync(join(checkout, "test"));
  writeFileSync(
    join(checkout, "test", "merge.test.js"),
    `it("merges", () => {});\nit("${heldBackTitle}", () => {});\n`,
  );
  git("add", "-A");
  git("commit", "--quiet", "-m", "the pull request");
  git("tag", "v2");
  return { root, checkout, baseCommit, mergeCommit: git("rev-parse", "HEAD") };
}

describe("a workspace the held-back oracle cannot be read out of", () => {
  it("holds the base and no object the pull request added", async () => {
    const made = repositoryWithAMergedPull();
    const workspace = join(made.root, "workspace");

    await prepareSealedWorkspace({
      ...made,
      workspace,
      testFile: "test/merge.test.js",
      untrackedFiles: { "swarm.toml": "[providers]\n" },
    });

    const inWorkspace = (...args: string[]) =>
      execFileSync("git", args, { cwd: workspace, encoding: "utf8" });
    expect(inWorkspace("rev-parse", "HEAD").trim()).toBe(made.baseCommit);
    expect(() => inWorkspace("cat-file", "-e", made.mergeCommit)).toThrow();
    expect(inWorkspace("for-each-ref").trim()).toBe("");
    expect(inWorkspace("remote").trim()).toBe("");
    // Every object left, read in full: the held-back case's title is in none of them.
    const objects = inWorkspace("cat-file", "--batch-all-objects", "--batch");
    expect(objects).not.toContain(heldBackTitle);
    expect(objects).toContain("export const merge");
    // The harness's own configuration never reaches a captured diff.
    expect(inWorkspace("status", "--porcelain").trim()).toBe("");
    expect(readFileSync(join(workspace, "swarm.toml"), "utf8")).toBe("[providers]\n");
  });

  it("refuses a workspace where the oracle's file is still reachable", async () => {
    const made = repositoryWithAMergedPull();

    // The "base" named here is the merge commit itself, so its test file survives the pruning.
    await expect(
      prepareSealedWorkspace({
        ...made,
        baseCommit: made.mergeCommit,
        workspace: join(made.root, "workspace"),
        testFile: "test/merge.test.js",
        untrackedFiles: {},
      }),
    ).rejects.toBeInstanceOf(WorkspaceHoldsTheOracle);
  });
});
