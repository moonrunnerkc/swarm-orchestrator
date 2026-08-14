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
    files.push({ path, kind: kindOf(oldPath, newPath), addedLines, removedLines });
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
      const paths = /^diff --git (?:"?a\/)?(.+?)"? (?:"?b\/)?(.+?)"?$/.exec(line);
      path = paths?.[2] ?? paths?.[1] ?? null;
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
      addedLines.push({ line: nextNewLine, text: line.slice(1) });
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
    if (line.startsWith("diff --git ")) {
      const paths = /^diff --git (?:"?a\/)?(.+?)"? (?:"?b\/)?(.+?)"?$/.exec(line);
      path = paths?.[2] ?? null;
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

function stripPrefix(raw: string): string | null {
  const path = raw.split("\t")[0]?.trim() ?? "";
  if (path === "/dev/null" || path.length === 0) {
    return null;
  }
  const unquoted = path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;
  return unquoted.replace(/^[ab]\//, "");
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
