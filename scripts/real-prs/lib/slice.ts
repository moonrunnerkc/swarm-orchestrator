// Slice a unified diff down to the hunk a finding touches, plus the
// immediately adjacent hunks in the same file for surrounding context.
// The arbiter sees this slice (not the whole PR) so its judgement is
// localized to the finding and its token cost is bounded.

import parseDiff from 'parse-diff';
import type { File as ParsedFile, Chunk } from 'parse-diff';

function fileHeader(file: ParsedFile): string {
  const from = file.from ?? '/dev/null';
  const to = file.to ?? '/dev/null';
  return [`diff --git a/${from} b/${to}`, `--- a/${from}`, `+++ b/${to}`].join('\n');
}

function chunkText(chunk: Chunk): string {
  const lines = chunk.changes.map((c) => c.content);
  return [chunk.content, ...lines].join('\n');
}

/** True when the finding's new-file line falls inside this hunk's
 *  post-image range. */
function chunkCoversLine(chunk: Chunk, line: number): boolean {
  const start = chunk.newStart;
  const end = chunk.newStart + chunk.newLines - 1;
  return line >= start && line <= end;
}

/**
 * Return a compact, valid unified diff containing the hunk that covers
 * `(file, line)` and, for context, the hunk before and after it in the
 * same file. Falls back to the file's first hunk when no hunk covers the
 * line, and to a head slice of the whole diff when the file is absent
 * (e.g. a whole-PR finding pointing at "(diff)").
 */
export function sliceDiffForFinding(
  unifiedDiff: string,
  file: string,
  line: number,
  maxChars = 12_000,
): string {
  const files = parseDiff(unifiedDiff);
  const target = files.find((f) => f.to === file || f.from === file);
  if (target === undefined || target.chunks.length === 0) {
    return unifiedDiff.slice(0, maxChars);
  }
  const chunks = target.chunks;
  let idx = chunks.findIndex((c) => chunkCoversLine(c, line));
  if (idx === -1) idx = 0;
  const lo = Math.max(0, idx - 1);
  const hi = Math.min(chunks.length - 1, idx + 1);
  const parts: string[] = [fileHeader(target)];
  for (let i = lo; i <= hi; i += 1) {
    const c = chunks[i];
    if (c !== undefined) parts.push(chunkText(c));
  }
  const text = parts.join('\n');
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}
