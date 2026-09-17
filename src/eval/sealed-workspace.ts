import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "./pr-task-judge.ts";

/**
 * A workspace for a mined task that holds the base commit's history and nothing after it.
 *
 * A clone of the task's checkout carries every object the checkout has, the merge commit
 * included, and the merge commit holds the pull request's test file: both oracle halves, one
 * `git show` away from the thing being measured. Checking out the base hides none of that. So
 * every ref and reflog is dropped and the clone is repacked with nothing unreachable kept, and
 * the result is checked rather than assumed: a workspace where the merge commit or the oracle's
 * blob still resolves is refused.
 */
export class WorkspaceHoldsTheOracle extends Error {
  constructor(what: string) {
    super(`the prepared workspace still holds ${what}, so nothing may run in it`);
    this.name = "WorkspaceHoldsTheOracle";
  }
}

async function git(cwd: string, args: readonly string[], timeoutMs = 10 * 60_000) {
  return runCommand("git", args, { cwd, timeoutMs });
}

async function must(cwd: string, args: readonly string[]): Promise<string> {
  const ran = await git(cwd, args);
  if (ran.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${ran.stderr.trim().slice(0, 300)}`);
  }
  return ran.stdout;
}

export async function prepareSealedWorkspace(input: {
  readonly checkout: string;
  readonly workspace: string;
  readonly baseCommit: string;
  readonly mergeCommit: string;
  readonly testFile: string;
  /** Written into the workspace and kept out of every captured diff. */
  readonly untrackedFiles: Readonly<Record<string, string>>;
}): Promise<void> {
  const { checkout, workspace, baseCommit, mergeCommit } = input;
  const oracleBlob = (
    await must(checkout, ["rev-parse", `${mergeCommit}:${input.testFile}`])
  ).trim();
  await must(checkout, ["clone", "--quiet", "--no-hardlinks", checkout, workspace]);
  await must(workspace, ["checkout", "--quiet", "--force", "--detach", baseCommit]);
  await must(workspace, ["remote", "remove", "origin"]);
  const refs = (await must(workspace, ["for-each-ref", "--format=%(refname)"]))
    .split("\n")
    .filter((name) => name.length > 0);
  for (const name of refs) await must(workspace, ["update-ref", "-d", name]);
  await must(workspace, ["reflog", "expire", "--expire=now", "--all"]);
  await must(workspace, ["gc", "--quiet", "--prune=now"]);

  for (const [what, object] of [
    ["the merge commit", mergeCommit],
    ["the pull request's test file", oracleBlob],
  ] as const) {
    // The blob may legitimately exist where the base already had this exact file, which the
    // viability filter rules out: a test file identical at the base cannot fail there.
    if ((await git(workspace, ["cat-file", "-e", object])).code === 0) {
      throw new WorkspaceHoldsTheOracle(what);
    }
  }
  if ((await must(workspace, ["rev-parse", "HEAD"])).trim() !== baseCommit) {
    throw new Error("the prepared workspace is not at the task's base commit");
  }

  for (const [name, content] of Object.entries(input.untrackedFiles)) {
    await writeFile(join(workspace, name), content);
  }
  await writeFile(
    join(workspace, ".git", "info", "exclude"),
    `${Object.keys(input.untrackedFiles).join("\n")}\n`,
  );
}
