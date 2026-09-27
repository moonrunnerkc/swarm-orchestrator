import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { PullRequestSnapshot } from "./change-source.ts";

const execute = promisify(execFile);
const commit = z.string().regex(/^[a-f0-9]{40,64}$/);
const response = z.object({
  number: z.number().int().positive(),
  base: z.object({ sha: commit, repo: z.object({ full_name: z.string() }) }),
  head: z.object({ sha: commit }),
});

/** Read authenticated metadata through gh only; credentials never enter candidate runners. */
export async function resolveGithubPullRequest(input: string): Promise<PullRequestSnapshot> {
  const match =
    /^(?:https:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/pull\/|#)([1-9][0-9]*)$/.exec(
      input,
    );
  if (match === null)
    throw new Error("--pr needs OWNER/REPO#NUMBER or https://github.com/OWNER/REPO/pull/NUMBER");
  const repository = `${match[1]}/${match[2]}`;
  const number = Number(match[3]);
  if (!Number.isSafeInteger(number)) throw new Error("invalid PR number");
  let stdout: string;
  try {
    ({ stdout } = await execute("gh", ["api", `repos/${repository}/pulls/${number}`], {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1_000_000,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        ...(process.env.GH_TOKEN ? { GH_TOKEN: process.env.GH_TOKEN } : {}),
        ...(process.env.GITHUB_TOKEN ? { GITHUB_TOKEN: process.env.GITHUB_TOKEN } : {}),
        GH_PROMPT_DISABLED: "1",
        GH_HOST: "github.com",
      },
    }));
  } catch {
    throw new Error(
      "GitHub PR metadata unavailable; install/authenticate gh for this repository and retry",
    );
  }
  const data = response.parse(JSON.parse(stdout));
  if (data.number !== number || data.base.repo.full_name.toLowerCase() !== repository.toLowerCase())
    throw new Error("GitHub response does not match requested repository and PR");
  return { repository: data.base.repo.full_name, number, base: data.base.sha, head: data.head.sha };
}
