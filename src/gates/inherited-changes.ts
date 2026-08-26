import type { WorkspaceChanges, WorkspaceProbe } from "./workspace-changes.ts";

/**
 * What was already different from the base commit when the run started.
 *
 * The gates measure a change against a base commit, which is right, and which quietly made a
 * run answer for whatever it found. A workspace with an uncommitted deletion and a stray
 * `.DS_Store` handed the file-set gate two files the model never opened: it had declared
 * nothing, because it had edited nothing, and the run escalated on somebody else's work.
 *
 * So the tree at the moment the run began is remembered, and a file still holding exactly what
 * it held then is not attributed to the run. A file the run does go on to edit reappears, since
 * its contents no longer match, which is what keeps this from being a way to launder an edit
 * through a dirty tree.
 */
export type InheritedChanges = ReadonlyMap<string, string | null>;

export async function captureInheritedChanges(probe: WorkspaceProbe): Promise<InheritedChanges> {
  const inherited = new Map<string, string | null>();
  const changes = await probe.changes();
  for (const file of changes.files) {
    inherited.set(file.path, await probe.readCurrent(file.path));
  }
  return inherited;
}

/** The same changes with the untouched inherited ones removed. */
export async function changesTheRunMade(
  changes: WorkspaceChanges,
  probe: WorkspaceProbe,
  inherited: InheritedChanges,
): Promise<WorkspaceChanges> {
  if (inherited.size === 0) {
    return changes;
  }

  const mine = [];
  for (const file of changes.files) {
    if (!inherited.has(file.path)) {
      mine.push(file);
      continue;
    }
    if ((await probe.readCurrent(file.path)) !== inherited.get(file.path)) {
      mine.push(file);
    }
  }
  return { baseRef: changes.baseRef, files: mine };
}
