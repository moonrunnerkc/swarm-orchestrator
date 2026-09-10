import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "../core/clock.ts";
import type { ModelClient, ModelRequest } from "../core/model-client.ts";
import { createFixedRandom } from "../core/test-doubles.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import { runInParallel } from "./parallel-run.ts";

/**
 * Gate 10 asks that Ctrl-C and abort leave no orphan processes, leases, worktrees or branches.
 * Processes and leases were proven; worktrees and branches were not, and a parallel run is where
 * they come from: one worktree and one branch per worker, the branch outliving the worktree on
 * purpose because the queue merges from it afterwards.
 *
 * So this is a real run, with real worktrees and real branches, interrupted while its workers are
 * in flight, and then the repository is asked what is left.
 */

const run = promisify(execFile);
const clock: Clock = { now: () => 1_700_000_000_000, sleep: () => Promise.resolve() };

let scratch = "";
let repository = "";
let coordinator: EvidenceRecorder;

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd });
  return stdout;
}

beforeEach(async () => {
  // Resolved, because git reports a worktree by its real path and macOS hands out a /private
  // symlink for the temporary directory, so an unresolved path compares unequal to itself.
  scratch = await realpath(await mkdtemp(join(tmpdir(), "swarm-interrupt-")));
  repository = join(scratch, "repo");
  await mkdir(join(repository, "src"), { recursive: true });
  await writeFile(
    join(repository, "package.json"),
    `${JSON.stringify({ name: "scratch", type: "module" }, null, 2)}\n`,
  );
  await writeFile(join(repository, "src/alpha.js"), "export const alpha = () => 'alpha';\n");
  await git(repository, "init", "--quiet");
  await git(repository, "config", "user.email", "interrupt@example.com");
  await git(repository, "config", "user.name", "interrupt");
  await git(repository, "add", ".");
  await git(repository, "commit", "--quiet", "-m", "seed");

  coordinator = await openEvidenceSession({
    root: join(scratch, "sessions"),
    sessionId: "coordinator",
    clock,
  });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/**
 * A model that pulls the interrupt itself, on its first turn.
 *
 * That is the moment the run is most exposed: every worker holds a worktree and a branch, and
 * nothing has been committed or merged, so anything left behind is left behind by the cleanup
 * rather than by a worker that never started.
 */
function modelThatInterrupts(interruption: AbortController): ModelClient {
  return {
    modelId: "fixture:interrupted",
    generate(_request: ModelRequest) {
      interruption.abort();
      return Promise.reject(new Error("the run was interrupted"));
    },
  };
}

async function worktreePaths(): Promise<readonly string[]> {
  const listed = await git(repository, "worktree", "list", "--porcelain");
  return listed
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim());
}

async function branches(): Promise<readonly string[]> {
  const listed = await git(repository, "branch", "--format=%(refname:short)");
  return listed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

describe("what an interrupted parallel run leaves in the repository", () => {
  it("leaves no worker worktree, no worker branch and no worktree directory", async () => {
    const interruption = new AbortController();
    const worktreeRoot = join(scratch, "worktrees");

    await runInParallel({
      repositoryRoot: repository,
      baseRef: "HEAD",
      tasks: ["shout in alpha", "shout in beta"],
      runId: "interrupted",
      scratchRoot: worktreeRoot,
      coordinator,
      createWorkerSession: (workerId) =>
        openEvidenceSession({ root: join(scratch, "sessions"), sessionId: workerId, clock }),
      createModel: () => modelThatInterrupts(interruption),
      clock,
      random: createFixedRandom(),
      emit: () => {},
      maxSteps: 4,
      attempts: 0,
      redundancy: 1,
      concurrency: 0,
      modelSpec: "fixture:interrupted",
      abortSignal: interruption.signal,
    });

    // The repository's own worktree and nothing else. A registration git still believes in is
    // an orphan even where the directory is gone: the next run fails adding a worktree there.
    expect(await worktreePaths()).toEqual([repository]);

    const left = (await branches()).filter((name) => name.startsWith("swarm/interrupted/"));
    // The integration branch is the run's result and is swept by nobody on purpose, so it is
    // named here rather than asserted away. Every worker branch has to be gone.
    expect(left.filter((name) => !name.endsWith("/integration"))).toEqual([]);

    const leftOnDisk = await readdir(worktreeRoot).catch(() => []);
    expect(leftOnDisk.filter((name) => name.startsWith("w"))).toEqual([]);
  });

  /**
   * The case cleanup cannot cover, and what recovers it. A process killed outright never reaches
   * a `finally`, so the registrations it left point at directories that are already gone, and the
   * next run has to be able to add a worktree at the same path rather than failing on it.
   */
  it("recovers a worktree registration a killed run left pointing at nothing", async () => {
    const abandoned = join(scratch, "worktrees", "wkilled");
    await git(repository, "worktree", "add", "--quiet", "-b", "swarm/killed/w1", abandoned, "HEAD");
    await rm(abandoned, { recursive: true, force: true });

    expect(await worktreePaths()).toContain(abandoned);

    const interruption = new AbortController();
    await runInParallel({
      repositoryRoot: repository,
      baseRef: "HEAD",
      tasks: ["shout in alpha"],
      runId: "after-the-kill",
      scratchRoot: join(scratch, "worktrees"),
      coordinator,
      createWorkerSession: (workerId) =>
        openEvidenceSession({ root: join(scratch, "sessions"), sessionId: workerId, clock }),
      createModel: () => modelThatInterrupts(interruption),
      clock,
      random: createFixedRandom(),
      emit: () => {},
      maxSteps: 4,
      attempts: 0,
      redundancy: 1,
      concurrency: 0,
      modelSpec: "fixture:interrupted",
      abortSignal: interruption.signal,
    });

    expect(await worktreePaths()).toEqual([repository]);
  });
});
