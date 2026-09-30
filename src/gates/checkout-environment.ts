import { execFile } from "node:child_process";
import { lstat, readFile, readlink, rm } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { digestOfBytes, digestOfJson } from "../evidence/canonical-json.ts";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { lockfileNames } from "./dependency-install.ts";

/**
 * What the git-ignored part of a checkout holds, by path, before a side of the comparison runs.
 *
 * The base control resets tracked files and removes untracked ones, and `git clean` keeps what
 * `.gitignore` names, because that is where the installed dependencies live. It is also where
 * build output lives. depose's base typecheck ran against the `dist/` the patched tree's build
 * had just written, passed on it, and a workflow-only patch read as a regression. The same leak
 * runs the other way: a module the patch's build emits and the base's does not stays in `dist/`,
 * fails the base's suite the same way, and a real regression reads as inherited.
 *
 * So the ignored tree is recorded once the environment is prepared, before any check runs, and
 * every switch between the two sides removes what was added since and refuses a comparison where
 * something recorded was changed or removed, since the bytes that were there cannot be put back.
 * Each entry is its kind, mode, size and modification time, and a link's target: what is compared
 * is whether a run touched the entry, not what the entry holds.
 */
export type IgnoredSnapshot = ReadonlyMap<string, string>;

const execution = promisify(execFile);

async function listed(checkout: string, args: readonly string[]): Promise<string[]> {
  const { stdout } = await execution("git", ["ls-files", "-z", ...args], {
    cwd: checkout,
    env: harnessChildEnvironment().variables,
    timeout: 120_000,
    maxBuffer: 512_000_000,
  });
  return [...new Set(stdout.split("\0").filter(Boolean))].sort();
}

/** Every ignored entry under the checkout, with the signature a later run's touch would change. */
export async function snapshotIgnored(checkout: string): Promise<IgnoredSnapshot> {
  const paths = await listed(checkout, ["--others", "--ignored", "--exclude-standard"]);
  const entries = new Map<string, string>();
  // Bounded concurrency: a node_modules tree is tens of thousands of entries.
  for (let start = 0; start < paths.length; start += 256) {
    const batch = paths.slice(start, start + 256);
    const signatures = await Promise.all(
      batch.map(async (path) => {
        const full = join(checkout, path);
        try {
          const entry = await lstat(full);
          const kind = entry.isSymbolicLink()
            ? `link:${await readlink(full)}`
            : entry.isFile()
              ? "file"
              : entry.isDirectory()
                ? "directory"
                : "other";
          return `${kind}:${entry.mode}:${entry.size}:${entry.mtimeMs}`;
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw cause;
        }
      }),
    );
    batch.forEach((path, index) => {
      const signature = signatures[index];
      if (signature !== null && signature !== undefined) entries.set(path, signature);
    });
  }
  return entries;
}

/** What a run did to the ignored tree: entries it added, and recorded entries it changed or removed. */
export function producedSince(
  before: IgnoredSnapshot,
  after: IgnoredSnapshot,
): { readonly added: readonly string[]; readonly altered: readonly string[] } {
  const added = [...after.keys()].filter((path) => !before.has(path)).sort();
  const altered = [...before]
    .filter(([path, signature]) => after.get(path) !== signature)
    .map(([path]) => path)
    .sort();
  return { added, altered };
}

/**
 * The fewest paths whose removal takes every added entry and nothing else: each added entry is
 * removed at its highest ancestor that holds no recorded entry and no file the tree keeps, so a
 * `dist/` the run created goes as one directory, a file added inside `node_modules/` goes alone,
 * and a `__pycache__/` beside a workspace member's tracked manifest goes without the manifest.
 */
export async function removalRoots(
  checkout: string,
  added: readonly string[],
  before: IgnoredSnapshot,
): Promise<string[]> {
  if (added.length === 0) return [];
  const kept = await listed(checkout, ["--cached", "--others", "--exclude-standard"]);
  const held = new Set<string>();
  for (const path of [...before.keys(), ...kept]) {
    const parts = path.split("/");
    for (let length = 1; length <= parts.length; length++)
      held.add(parts.slice(0, length).join("/"));
  }
  const roots = new Set<string>();
  for (const path of added) {
    const parts = path.split("/");
    for (let length = 1; length <= parts.length; length++) {
      const prefix = parts.slice(0, length).join("/");
      if (!held.has(prefix)) {
        roots.add(prefix);
        break;
      }
    }
  }
  return [...roots].sort();
}

/** Removes the added entries; a path git named is relative, and anything else is refused. */
export async function removeProduced(checkout: string, roots: readonly string[]): Promise<void> {
  for (const root of roots) {
    if (root === "" || isAbsolute(root) || root.split("/").includes(".."))
      throw new Error(`refusing to remove ${root}: not a path inside the checkout`);
    await rm(join(checkout, root), { recursive: true, force: true });
  }
}

/**
 * The lockfiles an install would read in the current tree, tracked or added, by content. Two
 * sides share an installed environment only where this is equal: a patch that changes a
 * lockfile installs different dependencies, and the base measured beside the patch's would be
 * measured with dependencies it does not declare.
 */
export async function lockfileIdentity(checkout: string): Promise<string> {
  const paths = (await listed(checkout, ["--cached", "--others", "--exclude-standard"])).filter(
    (path) => lockfileNames.includes(basename(path)),
  );
  const locks: { path: string; digest: string | null }[] = [];
  for (const path of paths) {
    try {
      locks.push({ path, digest: digestOfBytes(await readFile(join(checkout, path))) });
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      locks.push({ path, digest: null });
    }
  }
  return digestOfJson(locks);
}
