import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { git, gitText, scratchDirectory } from "./git.ts";

/** Where the change comes from. Each resolves to a base commit and the exact patch bytes. */
export type ChangeRequest =
  | { readonly kind: "working-tree"; readonly base: string }
  | { readonly kind: "range"; readonly range: string }
  | { readonly kind: "patch"; readonly path: string; readonly base: string };

export interface ResolvedChange {
  readonly source: ChangeRequest["kind"];
  readonly baseCommit: string;
  readonly patch: Buffer;
}

export class UnreadableChangeError extends Error {
  constructor(detail: string) {
    super(`the change cannot be read: ${detail}`);
    this.name = "UnreadableChangeError";
  }
}

const diffFlags = [
  "diff",
  "--binary",
  "--no-color",
  "--no-ext-diff",
  "--no-renames",
  "--no-textconv",
];
/** The verifier's own output directory never belongs to a change. */
const notTheChange = ":(exclude).swarm";

export async function commitOf(workspace: string, ref: string): Promise<string> {
  try {
    return await gitText(workspace, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${ref}^{commit}`,
    ]);
  } catch {
    throw new UnreadableChangeError(`${ref} is not a commit in ${workspace}`);
  }
}

export async function resolveChange(
  workspace: string,
  request: ChangeRequest,
): Promise<ResolvedChange> {
  if (request.kind === "patch") {
    const patch = await readFile(request.path).catch(() => {
      throw new UnreadableChangeError(`${request.path} cannot be read`);
    });
    return { source: "patch", baseCommit: await commitOf(workspace, request.base), patch };
  }
  if (request.kind === "range") {
    const [from, to, extra] = request.range.split("..");
    if (from === undefined || to === undefined || extra !== undefined || !from || !to) {
      throw new UnreadableChangeError(`${request.range} is not a range of the form base..head`);
    }
    const baseCommit = await commitOf(workspace, from);
    const head = await commitOf(workspace, to);
    const patch = await git(workspace, [...diffFlags, baseCommit, head, "--", ".", notTheChange]);
    return { source: "range", baseCommit, patch };
  }
  const baseCommit = await commitOf(workspace, request.base);
  // A private index holding the whole working tree, untracked files included, so the
  // workspace's own index is never touched.
  const scratch = await scratchDirectory("swarm-index-");
  try {
    const env = { GIT_INDEX_FILE: join(scratch.path, "index") };
    await git(workspace, ["read-tree", baseCommit], env);
    await git(workspace, ["add", "-A", "--", ".", notTheChange], env);
    const patch = await git(workspace, [...diffFlags, "--cached", baseCommit], env);
    return { source: "working-tree", baseCommit, patch };
  } finally {
    await scratch.remove();
  }
}
