import { describe, expect, it } from "vitest";
import { prTaskEvidenceRoot, prTaskWorkingRoot } from "./pr-task-paths.ts";

describe("where mined pull-request tasks keep their two kinds of file", () => {
  // 2 GB of clones and agent workspaces lived inside the repository, where vitest walked 1,753
  // foreign test files on every run and the suite went from 50s to 86s. Invariant 11 already says
  // this: what a session generates lives outside the workspace.
  it("keeps clones, workspaces and extracted oracles outside the repository", () => {
    expect(prTaskWorkingRoot("/home/someone")).toBe("/home/someone/.cache/swarm-pr-tasks");
  });

  // The results and the patches are evidence: small, and what `--rejudge` reads to re-score a
  // harness change without calling a model. Those stay committed, or the re-score reproduces for
  // nobody but the machine that happened to run it.
  it("keeps the results and the recorded patches in the repository", () => {
    expect(prTaskEvidenceRoot("/repo")).toBe("/repo/campaign/pr-tasks");
  });

  it("puts the two in different places, which is the whole point", () => {
    expect(prTaskWorkingRoot("/home/someone")).not.toContain("campaign");
  });

  // The policy guard denies every tool call under ~/.swarm, so an agent given a workspace there
  // has every read and write refused and produces an empty patch. It looks exactly like a model
  // that could not do the task.
  it("stays out of the evidence store, where tools are denied", () => {
    expect(prTaskWorkingRoot("/home/someone")).not.toContain("/.swarm");
  });
});
