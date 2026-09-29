import {
  diffGitHeaderPaths,
  PatchPathError,
  readFileLinePath,
  readWholePath,
} from "./patch-paths.ts";
import type { AddedLine, ChangedFile, ChangeKind } from "./workspace-changes.ts";

/**
 * Enough unified-diff parsing to get changed files and the line numbers of added lines.
 * Used for git's own output and for replaying stored patches, so both paths measure the
 * same way rather than agreeing by coincidence.
 */
export function parseUnifiedDiff(text: string): readonly ChangedFile[] {
  const files: ChangedFile[] = [];
  const lines = text.split("\n");

  let path: string | null = null;
  let oldPath: string | null = null;
  let newPath: string | null = null;
  let addedLines: AddedLine[] = [];
  let removedLines: string[] = [];
  let nextNewLine = 0;
  let inHunk = false;

  const flush = (): void => {
    if (path === null) {
      return;
    }
    // A path git only ever writes one header for, but a stored patch can carry two. Two
    // entries for one file are counted twice by everything downstream: its added lines land
    // in the coverage denominator twice, and the diff budget sees two changed files. Merging
    // rather than dropping, because the opposite of the lcov rule applies here: an ambiguous
    // coverage section can safely abstain, while a file dropped from the changed set is a
    // file the file-set check never sees.
    const at = files.findIndex((file) => file.path === path);
    const existing = files[at];
    if (existing === undefined) {
      files.push({
        path,
        kind: kindOf(oldPath, newPath),
        addedLines: numberedOnce([], addedLines),
        removedLines,
      });
    } else {
      files[at] = {
        ...existing,
        addedLines: numberedOnce(existing.addedLines, addedLines),
        removedLines: [...existing.removedLines, ...removedLines],
      };
    }
    path = null;
    oldPath = null;
    newPath = null;
    addedLines = [];
    removedLines = [];
    inHunk = false;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flush();
      path = headerPath(line);
      continue;
    }

    if (!inHunk && /^(?:rename|copy) to /.test(line)) {
      path = targetPath(line) ?? path;
      continue;
    }

    if (line.startsWith("--- ")) {
      oldPath = stripPrefix(line.slice(4));
      inHunk = false;
      continue;
    }

    if (line.startsWith("+++ ")) {
      newPath = stripPrefix(line.slice(4));
      if (path === null) {
        flush();
        path = newPath ?? oldPath;
      }
      if (newPath !== null) {
        path = newPath;
      }
      inHunk = false;
      continue;
    }

    if (line.startsWith("@@")) {
      const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (header !== null) {
        nextNewLine = Number(header[1]);
        inHunk = true;
      }
      continue;
    }

    if (!inHunk || path === null) {
      continue;
    }

    if (line.startsWith("+")) {
      // A hunk whose new side starts at zero has no new side: `@@ -1,2 +0,0 @@` is what git
      // writes for a deletion. An added line inside one is not a line anybody can point at,
      // and carrying it as line 0 put a number into the coverage denominator that no report
      // can ever name. Worse in the other direction, since an lcov `DA:0,1` parses: the two
      // together would count a line that does not exist as covered.
      if (nextNewLine >= 1) {
        addedLines.push({ line: nextNewLine, text: line.slice(1) });
      }
      nextNewLine += 1;
      continue;
    }
    if (line.startsWith("-")) {
      removedLines.push(line.slice(1));
      continue;
    }
    if (line.startsWith("\\")) {
      // "\ No newline at end of file" belongs to the line before it and moves nothing.
      continue;
    }
    // A context line, or the blank line git writes for an empty context line.
    nextNewLine += 1;
  }

  flush();
  return files;
}

/**
 * Reconstructs both sides of a patch from the patch alone: context plus removals is the
 * base text, context plus additions is the submitted text. Only sound for a diff whose
 * hunks cover the file, which is exactly the stored-patch case.
 */
export function reconstructSides(
  text: string,
): ReadonlyMap<string, { base: string; head: string }> {
  const sides = new Map<string, { base: string[]; head: string[] }>();
  let path: string | null = null;
  let inHunk = false;

  for (const line of text.split("\n")) {
    const header = line.startsWith("diff --git ");
    if (header || (!inHunk && /^(?:rename|copy) to /.test(line))) {
      path = header ? headerPath(line) : (targetPath(line) ?? path);
      inHunk = false;
      if (path !== null && !sides.has(path)) {
        sides.set(path, { base: [], head: [] });
      }
      continue;
    }
    if (line.startsWith("+++ ")) {
      const candidate = stripPrefix(line.slice(4));
      if (candidate !== null) {
        path = candidate;
        if (!sides.has(path)) {
          sides.set(path, { base: [], head: [] });
        }
      }
      inHunk = false;
      continue;
    }
    if (line.startsWith("--- ")) {
      inHunk = false;
      continue;
    }
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk || path === null) {
      continue;
    }
    const bucket = sides.get(path);
    if (bucket === undefined) {
      continue;
    }
    if (line.startsWith("+")) {
      bucket.head.push(line.slice(1));
    } else if (line.startsWith("-")) {
      bucket.base.push(line.slice(1));
    } else if (!line.startsWith("\\")) {
      const context = line.startsWith(" ") ? line.slice(1) : line;
      bucket.base.push(context);
      bucket.head.push(context);
    }
  }

  return new Map(
    [...sides].map(([file, bucket]) => [
      file,
      { base: bucket.base.join("\n"), head: bucket.head.join("\n") },
    ]),
  );
}

/**
 * One entry per line number, in order. A line can be claimed twice by a patch git would
 * never write: two headers for one path, or two hunks in one file both declaring they start
 * at line 1. Both reach the coverage arm as two entries for one line, which counts it twice
 * in the denominator and lets a patch move a ratchet measure by repeating itself.
 */
function numberedOnce(
  existing: readonly AddedLine[],
  incoming: readonly AddedLine[],
): readonly AddedLine[] {
  const byLine = new Map<number, AddedLine>();
  for (const added of [...existing, ...incoming]) {
    if (!byLine.has(added.line)) {
      byLine.set(added.line, added);
    }
  }
  return [...byLine.values()].sort((left, right) => left.line - right.line);
}

/**
 * The new-side path of a `diff --git` line when the line settles it alone, read by the same
 * rules as the scope checks. A bare header with spaces that splits more than one way is left to
 * the `+++` or `rename to` line that follows it.
 */
function headerPath(line: string): string | null {
  const pairs = unlessUnreadable(() => diffGitHeaderPaths(line.slice("diff --git ".length))) ?? [];
  const settled = pairs.length > 1 ? pairs.filter((pair) => pair.old === pair.new) : pairs;
  return settled.length === 1 ? (settled[0]?.new ?? null) : null;
}

function targetPath(line: string): string | null {
  return unlessUnreadable(() => readWholePath(line.replace(/^(?:rename|copy) to /, "")));
}

/**
 * Measurement parses git's own output and stored patches and never refuses one; a path it cannot
 * read is no path, and the scope checks that do refuse read the same patch through `pathsInPatch`.
 */
function unlessUnreadable<T>(read: () => T): T | null {
  try {
    return read();
  } catch (error) {
    if (error instanceof PatchPathError) return null;
    throw error;
  }
}

function stripPrefix(raw: string): string | null {
  const path = unlessUnreadable(() => readFileLinePath(raw));
  if (path === null || path.length === 0) {
    return null;
  }
  const stripped = path.replace(/^[ab]\//, "");
  // The emptiness check above runs before the prefix is stripped, so a bare `a/` survived it
  // and came back as the empty path: a changed file naming nothing, which the file-set check
  // can neither match nor report.
  return stripped.length === 0 ? null : stripped;
}

function kindOf(oldPath: string | null, newPath: string | null): ChangeKind {
  if (oldPath === null && newPath !== null) {
    return "added";
  }
  if (newPath === null && oldPath !== null) {
    return "deleted";
  }
  return "modified";
}
