import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordTurnBaseline, TurnBaselineError } from "./turn-baseline.ts";

const run = promisify(execFile);

let workspace = "";

async function git(...args: readonly string[]): Promise<string> {
  const { stdout } = await run("git", [...args], { cwd: workspace });
  return stdout.trim();
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "swarm-baseline-test-"));
  await git("init", "-q");
  await git("config", "user.email", "test@localhost");
  await git("config", "user.name", "test");
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function commitSomething(): Promise<void> {
  await writeFile(join(workspace, "tracked.txt"), "one\n");
  await git("add", "-A");
  await git("commit", "-q", "-m", "first");
}

describe("recording where a turn ended", () => {
  /**
   * The reason this exists rather than `git stash create`, which is the obvious way to get a
   * commit object for a dirty tree: stash leaves untracked files out, and a file the agent has
   * just written is the ordinary case. A baseline that forgets it would show the next turn
   * creating a file that already existed.
   */
  it("includes a file git does not track yet", async () => {
    await commitSomething();
    await writeFile(join(workspace, "created-by-the-agent.js"), "export const a = 1;\n");

    const baseline = await recordTurnBaseline({
      workspaceRoot: workspace,
      label: "turn 1",
      previousBase: "HEAD",
    });

    expect(baseline).not.toBeNull();
    const listed = await git("ls-tree", "--name-only", "-r", baseline ?? "");
    expect(listed.split("\n")).toContain("created-by-the-agent.js");
  });

  it("carries a modification to a tracked file", async () => {
    await commitSomething();
    await writeFile(join(workspace, "tracked.txt"), "two\n");

    const baseline = await recordTurnBaseline({
      workspaceRoot: workspace,
      label: "turn 1",
      previousBase: "HEAD",
    });

    expect(await git("show", `${baseline}:tracked.txt`)).toBe("two");
  });

  it("carries a file the turn deleted, so the next turn does not see it return", async () => {
    await commitSomething();
    await rm(join(workspace, "tracked.txt"));

    const baseline = await recordTurnBaseline({
      workspaceRoot: workspace,
      label: "turn 1",
      previousBase: "HEAD",
    });

    expect(await git("ls-tree", "--name-only", "-r", baseline ?? "")).toBe("");
  });

  /**
   * The whole point, stated as the comparison that will actually be made: turn 2 is measured
   * between turn 1's baseline and its own, so turn 1's files are not turn 2's work.
   *
   * Note what is deliberately not asserted here. `git diff <baseline>` from the person's own
   * index reports turn 1's file as *deleted*, because the file is in the baseline commit and
   * not in that index. That is a fact about comparing a commit to an index, not a defect in the
   * object written here, and it is why the measurement is taken between two baselines rather
   * than between a baseline and the working tree.
   */
  it("shows only the second turn's work between one baseline and the next", async () => {
    await commitSomething();
    await writeFile(join(workspace, "from-turn-one.js"), "export const a = 1;\n");
    const first = await recordTurnBaseline({
      workspaceRoot: workspace,
      label: "turn 1",
      previousBase: "HEAD",
    });

    await writeFile(join(workspace, "from-turn-two.js"), "export const b = 2;\n");
    const second = await recordTurnBaseline({
      workspaceRoot: workspace,
      label: "turn 2",
      previousBase: first ?? "HEAD",
    });

    expect(await git("diff", "--name-only", first ?? "", second ?? "")).toBe("from-turn-two.js");
  });

  /** A person's own index and HEAD are theirs. Baselining is bookkeeping and must not move them. */
  it("moves neither HEAD nor the index the person is using", async () => {
    await commitSomething();
    const headBefore = await git("rev-parse", "HEAD");
    const statusBefore = await git("status", "--porcelain");
    await writeFile(join(workspace, "untracked.js"), "export const a = 1;\n");

    await recordTurnBaseline({ workspaceRoot: workspace, label: "turn 1", previousBase: "HEAD" });

    expect(await git("rev-parse", "HEAD")).toBe(headBefore);
    expect(statusBefore).toBe("");
    // Still untracked afterwards: `add -A` went to the temporary index, not this one.
    expect(await git("status", "--porcelain")).toBe("?? untracked.js");
  });

  it("chains from the previous baseline rather than always from HEAD", async () => {
    await commitSomething();
    const first = await recordTurnBaseline({
      workspaceRoot: workspace,
      label: "turn 1",
      previousBase: "HEAD",
    });
    await writeFile(join(workspace, "second.js"), "export const b = 2;\n");

    const second = await recordTurnBaseline({
      workspaceRoot: workspace,
      label: "turn 2",
      previousBase: first ?? "HEAD",
    });

    expect(await git("rev-parse", `${second}^`)).toBe(first);
  });

  /**
   * A repository with no commits has no parent to hang an object from. The caller keeps the
   * base it had rather than being handed an object that means something else.
   */
  it("answers null in a repository with no commit yet", async () => {
    await writeFile(join(workspace, "only-file.js"), "export const a = 1;\n");

    expect(
      await recordTurnBaseline({
        workspaceRoot: workspace,
        label: "turn 1",
        previousBase: "HEAD",
      }),
    ).toBeNull();
  });

  it("works where the person has configured no git identity", async () => {
    await commitSomething();
    await git("config", "--unset", "user.email");
    await git("config", "--unset", "user.name");
    await writeFile(join(workspace, "created.js"), "export const a = 1;\n");

    expect(
      await recordTurnBaseline({
        workspaceRoot: workspace,
        label: "turn 1",
        previousBase: "HEAD",
      }),
    ).not.toBeNull();
  });

  it("says what went wrong, and what it means for the next turn, when git refuses", async () => {
    const notARepository = await mkdtemp(join(tmpdir(), "swarm-not-a-repo-"));
    await mkdir(join(notARepository, "sub"), { recursive: true });

    await expect(
      recordTurnBaseline({
        workspaceRoot: join(notARepository, "sub"),
        label: "turn 1",
        previousBase: "0000000000000000000000000000000000000000",
      }),
    ).resolves.toBeNull();

    await rm(notARepository, { recursive: true, force: true });
  });
});

describe("the error it raises", () => {
  it("names the workspace and does not reprint git's option list", () => {
    const error = new TurnBaselineError(
      "/tmp/ws",
      new Error("Command failed\nfatal: bad object\nusage: git commit-tree ...\n"),
    );

    expect(error.message).toContain("/tmp/ws");
    expect(error.message).toContain("fatal: bad object");
    expect(error.message).not.toContain("usage:");
  });
});
