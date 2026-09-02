import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { knownFix, proofTask, seedProofWorkspace, seededFiles } from "./seed-proof-workspace.mjs";

const scratchDirectories = [];
afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function seeded() {
  const directory = mkdtempSync(join(tmpdir(), "proof-workspace-test-"));
  scratchDirectories.push(directory);
  return seedProofWorkspace(directory);
}

/** TAP rather than the default reporter, so the outcome is read from result points and not symbols. */
function runTests(directory) {
  return spawnSync(process.execPath, ["--test", "--test-reporter=tap"], {
    cwd: directory,
    encoding: "utf8",
  });
}

describe("the seeded workspace", () => {
  it("is a committed repository holding exactly the seeded files", () => {
    const { directory, baseCommit } = seeded();

    expect(baseCommit).toMatch(/^[0-9a-f]{40}$/);
    const tracked = spawnSync("git", ["ls-files"], { cwd: directory, encoding: "utf8" }).stdout;
    expect(tracked.trim().split("\n").sort()).toEqual(Object.keys(seededFiles).sort());
    const status = spawnSync("git", ["status", "--porcelain"], { cwd: directory, encoding: "utf8" });
    expect(status.stdout).toBe("");
  });

  it("fails its own test as committed, on the defect the task names", () => {
    const { directory, task } = seeded();

    const outcome = runTests(directory);

    expect(outcome.status).not.toBe(0);
    expect(outcome.stdout).toContain("not ok");
    expect(outcome.stdout).toContain("a value above the range clamps to the upper bound");
    expect(task).toBe(proofTask);
    expect(task).toContain("src/clamp.mjs");
  });

  /** Without this a run that never went green could be the seed's fault rather than the model's. */
  it("passes once the one-line fix is applied, so the task is solvable", () => {
    const { directory } = seeded();
    const path = join(directory, knownFix.file);
    const source = readFileSync(path, "utf8");
    expect(source).toContain(knownFix.from);
    writeFileSync(path, source.replace(knownFix.from, knownFix.to));

    const outcome = runTests(directory);

    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain("# fail 0");
  });
});
