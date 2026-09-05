import { chmod, mkdir } from "node:fs/promises";

/**
 * The session store holds every prompt, every tool argument, and the content of every file the
 * run read. It lives outside the workspace so the workspace cannot reach it (invariant 11), and
 * then it was created at whatever the operator's umask allowed: on a shared machine, readable
 * by everyone. Asking for the mode is not enough on its own, because a directory that already
 * exists keeps the mode it was made with, so an existing one is narrowed rather than assumed.
 */
export const ownerOnlyDirectory = 0o700;
export const ownerOnlyFile = 0o600;

export async function makeOwnerOnlyDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: ownerOnlyDirectory });
  // A umask can only remove bits from the mode above, so it cannot widen what was asked for.
  // What it cannot fix is a directory made before this rule existed, which this narrows.
  await chmod(path, ownerOnlyDirectory);
}
