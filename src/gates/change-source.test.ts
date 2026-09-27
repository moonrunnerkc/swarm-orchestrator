import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { resolveChangeSource, validatePatchForms, validateSourceRef } from "./change-source.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";

let root = "";
let base = "";
let head = "";
const clock = { now: () => Date.now(), sleep: async () => {} };
const commands = createNodeCommandRunner(clock, harnessChildEnvironment());
function git(...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=fixture", "-c", "user.email=fixture@example.test", ...args],
    { cwd: root, encoding: "utf8" },
  ).trim();
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-source-"));
  git("init", "-q");
  await writeFile(join(root, "value.txt"), "before\n");
  git("add", ".");
  git("commit", "-qm", "base");
  base = git("rev-parse", "HEAD");
  git("checkout", "-qb", "feature");
  await writeFile(join(root, "value.txt"), "after\n");
  await writeFile(join(root, "binary.dat"), Buffer.from([0, 1, 2, 3]));
  git("add", ".");
  git("commit", "-qm", "feature");
  head = git("rev-parse", "HEAD");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("pins equivalent branch and patch inputs and preserves dirty index and untracked files", async () => {
  await writeFile(join(root, "value.txt"), "staged\n");
  git("add", "value.txt");
  await writeFile(join(root, "value.txt"), "unstaged\n");
  await writeFile(join(root, "personal.txt"), "untracked\n");
  const status = git("status", "--porcelain=v1");
  const index = git("diff", "--cached");
  const branch = await resolveChangeSource(
    { workspace: root, branch: "feature", baseRef: base },
    commands,
  );
  const patchFile = join(root, ".git", "candidate.patch");
  await writeFile(patchFile, branch.patch);
  const patch = await resolveChangeSource({ workspace: root, patchFile, baseRef: base }, commands);
  expect(branch.identity.head).toBe(head);
  expect(branch.identity.patchDigest).toBe(patch.identity.patchDigest);
  expect(branch.patch).toContain("GIT binary patch");
  expect(git("status", "--porcelain=v1")).toBe(status);
  expect(git("diff", "--cached")).toBe(index);
  expect(await readFile(join(root, "personal.txt"), "utf8")).toBe("untracked\n");
});

it("uses merge-base normally and honors an explicitly exact base", async () => {
  git("checkout", "-qb", "target", base);
  await writeFile(join(root, "target.txt"), "target advance\n");
  git("add", ".");
  git("commit", "-qm", "target");
  const target = git("rev-parse", "HEAD");
  const normal = await resolveChangeSource(
    { workspace: root, branch: "feature", baseRef: "target" },
    commands,
  );
  const exact = await resolveChangeSource(
    { workspace: root, branch: "feature", baseRef: "target", exactBase: true },
    commands,
  );
  expect(normal.identity.targetBase).toBe(target);
  expect(normal.identity.comparisonBase).toBe(base);
  expect(normal.patch).not.toContain("target.txt");
  expect(exact.identity.comparisonBase).toBe(target);
  expect(exact.patch).toContain("deleted file mode");
});

it("fetches only the resolved PR snapshot even if the transport's branch has moved", async () => {
  const invoked: string[][] = [];
  const result = await resolveChangeSource(
    { workspace: root, pr: "owner/repo#1", baseRef: "HEAD" },
    {
      ...commands,
      runVouched: async (argv, options) => {
        invoked.push([...argv]);
        // This transport contract test uses existing immutable objects, not a claimed remote integration.
        if (argv.includes("fetch"))
          return { exitCode: 0, stdout: "", stderr: "", durationMs: 0, unavailable: null };
        return commands.runVouched(argv, options);
      },
    },
    async () => ({ repository: "owner/repo", number: 1, base, head }),
  );
  expect(result.identity.head).toBe(head);
  expect(invoked.find((argv) => argv.includes("fetch"))?.slice(-2)).toEqual([base, head]);
});

it.each(["--output=/tmp/pwn", "foo;touch-x", "$(id)", "a..b", "x\n--upload-pack=x"])(
  "refuses hostile or unsupported ref %s",
  (ref) => {
    expect(() => validateSourceRef(ref)).toThrow("unsupported Git ref");
  },
);
it.each(["120000", "160000"])("refuses special file mode %s by name", (mode) => {
  expect(() => validatePatchForms(`diff --git a/link b/link\nnew file mode ${mode}\n`)).toThrow(
    "symlink and submodule",
  );
});
it("refuses traversal and unreadable path encodings", () => {
  expect(() => validatePatchForms("diff --git a/../file b/../file\n")).toThrow("unsafe patch path");
  expect(() => validatePatchForms('diff --git "a/space file" "b/space file"\n')).toThrow(
    "patch paths",
  );
});
it("rejects ambiguous inputs before spawning Git", async () => {
  await expect(
    resolveChangeSource(
      { workspace: root, patchFile: "x", branch: "feature", baseRef: base },
      commands,
    ),
  ).rejects.toThrow("exactly one");
});

it("retains ancestry syntax for existing exact-base callers", () => {
  expect(validateSourceRef("HEAD~1")).toBe("HEAD~1");
});
