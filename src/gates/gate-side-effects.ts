import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { WorkspaceProbe } from "./workspace-changes.ts";

/**
 * The workspace's changed files and their contents, as they stand: what a check must leave as it
 * found it. Ignored files (build output, installed dependencies) are not in it, so a check that
 * builds into them is undisturbed.
 */
export async function snapshotChanges(
  probe: WorkspaceProbe,
): Promise<ReadonlyMap<string, string | null>> {
  const files = new Map<string, string | null>();
  for (const file of (await probe.changes()).files)
    files.set(file.path, await probe.readCurrent(file.path));
  return files;
}

/**
 * Undoes what a check wrote to the workspace since `before`, and names each file it put back.
 *
 * A check must not author the change it measures. ufo's build script runs automd, which writes the
 * documentation of each exported function into README.md: run as a gate in the workspace, it made
 * README.md part of every later candidate, outside the declared file set, and on October 24 the
 * ratchet rolled back all six repairs that had fixed their lint. A file the check changed goes
 * back to what it held before the check (or to its base content where the check created the
 * change), and a file the check created is removed.
 */
export async function undoCheckWrites(
  workspaceRoot: string,
  probe: WorkspaceProbe,
  before: ReadonlyMap<string, string | null>,
): Promise<readonly string[]> {
  const now = await probe.changes();
  const paths = new Set([...now.files.map((file) => file.path), ...before.keys()]);
  const written: string[] = [];
  for (const path of [...paths].sort()) {
    const expected = before.has(path) ? (before.get(path) ?? null) : await probe.readBase(path);
    const current = await probe.readCurrent(path);
    if (current === expected) continue;
    written.push(path);
    const absolute = join(workspaceRoot, path);
    if (expected === null) await rm(absolute, { force: true });
    else {
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, expected, "utf8");
    }
  }
  return written;
}
