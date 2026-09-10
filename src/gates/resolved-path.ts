import { realpathSync } from "node:fs";

/**
 * The path with its symlinks resolved, or the path itself where the filesystem cannot say.
 *
 * Two things have to agree about which file they are talking about: a coverage report, which
 * names the file the process opened, and the harness, which names the directory it cloned into.
 * On macOS the system scratch directory is reached through a symlink, so those are one file under
 * two spellings and comparing them as text puts every file outside the tree.
 *
 * Resolving is what the filesystem can add and never a requirement: a path that is not there is
 * given back as it came, because its own text is the only honest answer about it.
 */
export function resolvedPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
