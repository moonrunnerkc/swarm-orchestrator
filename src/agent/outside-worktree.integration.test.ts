import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bash, fixture, scripted } from "./test-doubles.ts";

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/**
 * A run in auto approval may change its own worktree and nothing else. On dependency-detector
 * (session 20261101T084321-1087ff) one pushed a branch to the repository it was cloned from and
 * cloned that repository to /tmp. The managed worktree shares the user's repository, so a ref,
 * a tag or a config value written there lands in the user's own .git.
 */
describe("a run in auto approval, against everything outside its worktree", () => {
  it("leaves the user's repository, its remote and the files beside it as they were", async () => {
    const probe = await fixture();
    const remote = join(probe.root, "remote.git");
    execFileSync("git", ["init", "-q", "--bare", remote]);
    probe.git("remote", "add", "origin", remote);
    const refsBefore = probe.git("for-each-ref", "--format=%(refname) %(objectname)");
    const configBefore = await readFile(join(probe.repo, ".git", "config"), "utf8");
    const attempts = [
      "git push origin HEAD:refs/heads/escaped",
      "git branch escaped",
      "git tag escaped",
      "git update-ref refs/heads/escaped HEAD",
      "git checkout -b escaped",
      "git switch -c escaped",
      "git config user.name escaped",
      "git remote add escaped /tmp/escaped.git",
      `git worktree add ${join(probe.root, "second")}`,
      `printf x > ${join(probe.root, "outside.txt")}`,
      `cp half.mjs ${join(probe.root, "copied.mjs")}`,
      `git --git-dir=${join(probe.repo, ".git")} log -1`,
      `git clone -q ${probe.repo} ${join(probe.root, "clone")}`,
    ];
    const ran = await probe.run(scripted(attempts.map(bash)), { maxSteps: attempts.length + 1 });

    expect(probe.git("for-each-ref", "--format=%(refname) %(objectname)")).toBe(refsBefore);
    expect(await readFile(join(probe.repo, ".git", "config"), "utf8")).toBe(configBefore);
    expect(execFileSync("git", ["for-each-ref"], { cwd: remote, encoding: "utf8" })).toBe("");
    for (const left of ["outside.txt", "copied.mjs", "second", "clone"]) {
      expect(await exists(join(probe.root, left)), left).toBe(false);
    }
    expect(probe.git("worktree", "list").split("\n")).toHaveLength(1);
    expect(ran.report.stop).not.toBe("model-error");
  });
});
