import { readFile } from "node:fs/promises";
import { z } from "zod";
import { digestOfBytes } from "../evidence/canonical-json.ts";
import type { GateCommandRunner } from "./gate-definition.ts";
import { readPatchFiles } from "./patch-paths.ts";

const sha = z.string().regex(/^[a-f0-9]{40,64}$/);
export const sourceIdentitySchema = z.strictObject({
  version: z.literal(1),
  mode: z.enum(["patch", "branch", "pr"]),
  targetBase: sha,
  comparisonBase: sha,
  head: sha.nullable(),
  patchDigest: z.string(),
  repository: z.string().nullable(),
  pullRequest: z.number().int().positive().nullable(),
  comparison: z.enum(["exact", "merge-base"]),
});
export type SourceIdentity = z.infer<typeof sourceIdentitySchema>;
export interface PullRequestSnapshot {
  readonly repository: string;
  readonly number: number;
  readonly base: string;
  readonly head: string;
}
export interface ChangeSourceOptions {
  readonly workspace: string;
  readonly patchFile?: string;
  readonly branch?: string;
  readonly pr?: string;
  readonly baseRef: string;
  readonly exactBase?: boolean;
}

/** Refuse options and revision expressions that do not name an ordinary ref or commit. */
export function validateSourceRef(ref: string): string {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_./~^{}@-]*$/.test(ref) || ref.includes("..") || ref.endsWith("/"))
    throw new Error("unsupported Git ref: use a branch, tag, or immutable commit ID");
  return ref;
}

/** Resolve once, then construct the complete binary-capable patch from immutable objects. */
export async function resolveChangeSource(
  options: ChangeSourceOptions,
  commands: GateCommandRunner,
  resolvePr?: (input: string) => Promise<PullRequestSnapshot>,
): Promise<{ patch: string; identity: SourceIdentity }> {
  const modes = [options.patchFile, options.branch, options.pr].filter(
    (value) => value !== undefined,
  );
  if (modes.length !== 1) throw new Error("select exactly one of --patch, --branch, or --pr");
  const git = async (args: readonly string[]) => {
    const ran = await commands.runVouched(["git", ...args], {
      cwd: options.workspace,
      timeoutMs: 120_000,
    });
    if (ran.exitCode !== 0 || ran.unavailable !== null || ran.outputTruncated)
      throw new Error(
        `source retrieval failed (${args[0]}): ${ran.unavailable ?? ran.stderr.slice(0, 1000)}`,
      );
    return ran.stdout;
  };
  const commit = async (ref: string) =>
    sha.parse(
      (
        await git([
          "rev-parse",
          "--verify",
          "--end-of-options",
          `${validateSourceRef(ref)}^{commit}`,
        ])
      ).trim(),
    );
  let targetBase: string;
  let head: string | null = null;
  let snapshot: PullRequestSnapshot | undefined;
  if (options.pr !== undefined) {
    if (resolvePr === undefined) throw new Error("GitHub PR retrieval is unavailable");
    snapshot = await resolvePr(options.pr);
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(snapshot.repository))
      throw new Error("invalid GitHub repository identity");
    sha.parse(snapshot.base);
    sha.parse(snapshot.head);
    // Fetch object IDs, never a second reading of the moving PR ref. FETCH_HEAD is not consulted.
    await git([
      "-c",
      "credential.helper=",
      "fetch",
      "--no-tags",
      "--no-write-fetch-head",
      `https://github.com/${snapshot.repository}.git`,
      snapshot.base,
      snapshot.head,
    ]);
    targetBase = await commit(snapshot.base);
    head = await commit(snapshot.head);
    if (targetBase !== snapshot.base || head !== snapshot.head)
      throw new Error("fetched PR objects disagree with the resolved snapshot; start a new run");
  } else {
    targetBase = await commit(options.baseRef);
    if (options.branch !== undefined) head = await commit(options.branch);
  }
  const comparison = head === null || options.exactBase ? "exact" : "merge-base";
  const comparisonBase =
    comparison === "exact" || head === null
      ? snapshot && options.exactBase
        ? await commit(options.baseRef)
        : targetBase
      : sha.parse((await git(["merge-base", targetBase, head])).trim());
  const patch =
    head === null
      ? await readFile(options.patchFile as string, "utf8")
      : await git([
          "-c",
          "core.quotePath=true",
          "diff",
          "--binary",
          "--full-index",
          "--no-ext-diff",
          "--no-textconv",
          "--no-renames",
          comparisonBase,
          head,
          "--",
        ]);
  validatePatchForms(patch);
  return {
    patch,
    identity: sourceIdentitySchema.parse({
      version: 1,
      mode: snapshot ? "pr" : head ? "branch" : "patch",
      targetBase,
      comparisonBase,
      head,
      patchDigest: digestOfBytes(patch),
      comparison,
      repository: snapshot?.repository ?? null,
      pullRequest: snapshot?.number ?? null,
    }),
  };
}

/** Unsupported path encodings and special entries cannot disappear from scope checks. */
export function validatePatchForms(patch: string): void {
  if (Buffer.byteLength(patch) > 16_000_000) throw new Error("patch exceeds the 16 MB input limit");
  if (
    /^(?:new file mode|deleted file mode|old mode|new mode) (?:120000|160000)$/m.test(patch) ||
    /^index [^\n]+ (?:120000|160000)$/m.test(patch)
  )
    throw new Error(
      "symlink and submodule patches are unsupported; verify an ordinary-file change",
    );
  if (patch.trim() !== "" && !patch.startsWith("diff --git "))
    throw new Error("only complete Git patches beginning with diff --git are supported");
  for (const file of readPatchFiles(patch)) {
    // A bare `---`/`+++` pair after a hunk is a further file to `git apply`; a Git patch never
    // writes one, so it can only be an attempt to name a file outside the Git headers.
    if (file.header !== "git")
      throw new Error("only complete Git patches beginning with diff --git are supported");
    for (const path of [file.oldPath, file.newPath])
      if (path !== null && unsafePatchPath(path)) throw new Error("unsafe patch path refused");
  }
}

// Characters HFS+ ignores when comparing names, so `.g\u200cit` is `.git` on macOS.
const hfsIgnorable = /[\u200c-\u200f\u202a-\u202e\u206a-\u206f\ufeff]/g;

/**
 * A decoded path that could leave the checkout or reach Git's own directory: absolute, holding
 * NUL or a backslash, or with an empty, `.`, `..` or `.git` component. `.git` is compared the way
 * case-folding macOS and Windows filesystems compare it, so `.GIT`, `.git.` and `git~1` count.
 */
function unsafePatchPath(path: string): boolean {
  return (
    path.startsWith("/") ||
    path.includes("\0") ||
    path.includes("\\") ||
    path.split("/").some((part) => {
      const folded = part
        .replace(hfsIgnorable, "")
        .toLowerCase()
        .replace(/[. ]+$/, "");
      return (
        part === "" || part === "." || part === ".." || folded === ".git" || folded === "git~1"
      );
    })
  );
}
