import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

/**
 * Where a change moved the lines of a file, read from a unified diff (failure-identity-v5).
 *
 * A static check that names a problem by file and line can only show a problem is the base's own
 * if the base's occurrence can be followed to the candidate's line. The hunks of the change are
 * what does that: a line no hunk touched moves by what the hunks before it added and removed, and
 * a line a hunk touched has no counterpart. Nothing here guesses a move the hunks do not give.
 */

/** A zero-context hunk: `[oldStart, oldLines, newStart, newLines]`, as git's `@@` header names it. */
export type Hunk = readonly [number, number, number, number];

/**
 * A file's hunks, an empty list where the change left it as it was, or `unmappable` where its
 * lines cannot be followed (binary, renamed, outside the checkout, a diff the reader could not
 * parse).
 */
export type FileChanges = readonly Hunk[] | "unmappable";

/** The changes of each file a diagnostic names, keyed by the path exactly as the tool printed it. */
export type SourceChanges = Readonly<Record<string, FileChanges>>;

/**
 * Every file a unified diff changes, by its path after the change, with its zero-context hunks.
 * Hunks with context (`git diff` with its default three lines) are reduced to the runs of removed
 * and added lines inside them, so the result is the same whichever context the diff was taken
 * with.
 */
export function hunksByFile(diff: string): Map<string, FileChanges> {
  const files = new Map<string, FileChanges>();
  let path: string | null = null;
  let hunks: Hunk[] = [];
  let unmappable = false;
  let oldLine = 0;
  let newLine = 0;
  // The open run of removed and added lines: where it starts on each side and how long it is.
  let run: { oldStart: number; removed: number; newStart: number; added: number } | null = null;
  const closeRun = () => {
    if (run === null) return;
    hunks.push([
      run.removed === 0 ? run.oldStart - 1 : run.oldStart,
      run.removed,
      run.added === 0 ? run.newStart - 1 : run.newStart,
      run.added,
    ]);
    run = null;
  };
  const closeFile = () => {
    closeRun();
    if (path !== null) files.set(path, unmappable ? "unmappable" : hunks);
    path = null;
    hunks = [];
    unmappable = false;
  };
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      closeFile();
      // The path after the change, from `b/...`; a quoted name is one git escaped, which this
      // reader does not unescape, so that file is unmappable.
      const named = / b\/(.+)$/.exec(line)?.[1];
      path = named ?? line;
      if (named === undefined || line.includes('"')) unmappable = true;
      continue;
    }
    if (path === null) continue;
    if (/^(rename|copy) (from|to) |^Binary files |^GIT binary patch/.test(line)) {
      unmappable = true;
      continue;
    }
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (header !== null) {
      closeRun();
      const oldCount = header[2] === undefined ? 1 : Number(header[2]);
      const newCount = header[4] === undefined ? 1 : Number(header[4]);
      // A zero count names the line before the hunk; the next line read is the one after it.
      oldLine = Number(header[1]) + (oldCount === 0 ? 1 : 0);
      newLine = Number(header[3]) + (newCount === 0 ? 1 : 0);
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ")) continue;
    if (line.startsWith("-")) {
      run ??= { oldStart: oldLine, removed: 0, newStart: newLine, added: 0 };
      run.removed += 1;
      oldLine += 1;
    } else if (line.startsWith("+")) {
      run ??= { oldStart: oldLine, removed: 0, newStart: newLine, added: 0 };
      run.added += 1;
      newLine += 1;
    } else if (line.startsWith(" ")) {
      closeRun();
      oldLine += 1;
      newLine += 1;
    }
  }
  closeFile();
  return files;
}

/**
 * Where a base line is after the change: its new line number, or null where a hunk removed or
 * rewrote it, or the file's lines cannot be followed.
 */
export function movedLine(changes: FileChanges, line: number): number | null {
  if (changes === "unmappable") return null;
  let shift = 0;
  for (const [oldStart, oldLines, , newLines] of changes) {
    if (oldLines > 0 && line >= oldStart && line < oldStart + oldLines) return null;
    // A pure insertion names the line it follows; a removal ends on its last line.
    const before = oldLines === 0 ? oldStart < line : oldStart + oldLines - 1 < line;
    if (before) shift += newLines - oldLines;
  }
  return line + shift;
}

/**
 * The changes of each file a run printed, keyed as printed: a path is read against the directory
 * the check ran in, by any of the names it goes by (a tool prints `/private/tmp/...` for a
 * checkout made under `/tmp`), and one outside it cannot be followed. A file the diff does not
 * name is unchanged.
 */
export function changesOfPrinted(
  printed: readonly string[],
  diff: string,
  checkout: string | readonly string[],
): SourceChanges {
  const byFile = hunksByFile(diff);
  const roots = typeof checkout === "string" ? [checkout] : checkout;
  const changes: Record<string, FileChanges> = {};
  for (const path of [...new Set(printed)].sort()) {
    const inCheckout = roots
      .map((root) => relative(root, isAbsolute(path) ? path : resolve(root, path)))
      .find((one) => !one.startsWith("..") && !isAbsolute(one));
    changes[path] =
      inCheckout === undefined
        ? "unmappable"
        : (byFile.get(inCheckout.split("\\").join("/")) ?? []);
  }
  return changes;
}

/** A directory by the names it goes by: as given, and with its symbolic links resolved. */
export async function namesOf(directory: string): Promise<readonly string[]> {
  const resolved = await realpath(directory).catch(() => directory);
  return resolved === directory ? [directory] : [directory, resolved];
}
