// Hunk-aware chunking for the judge. The judge used to head-truncate any
// diff over its context budget, so a defect in the tail of a large PR was
// invisible to it. This splits a diff into chunks that each stay under the
// budget, grouping whole hunks and repeating each file's header in every
// chunk that carries its hunks, so each chunk is independently parseable.
// A single hunk larger than the budget is emitted on its own (it cannot be
// split without corrupting it); that is the only place truncation could
// still bite, and it is the rare case.

export interface DiffHunkRef {
  file: string;
  hunkText: string;
}

interface FileSection {
  header: string;
  hunks: string[];
}

function splitFileSections(diff: string): FileSection[] {
  const lines = diff.split('\n');
  const sections: FileSection[] = [];
  let current: { headerLines: string[]; hunks: string[][] } | null = null;
  let mode: 'header' | 'hunk' = 'header';
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (current !== null) sections.push(materialize(current));
      current = { headerLines: [line], hunks: [] };
      mode = 'header';
      continue;
    }
    if (current === null) continue;
    if (line.startsWith('@@ ')) {
      current.hunks.push([line]);
      mode = 'hunk';
      continue;
    }
    if (mode === 'header') current.headerLines.push(line);
    else current.hunks[current.hunks.length - 1]?.push(line);
  }
  if (current !== null) sections.push(materialize(current));
  return sections;
}

function materialize(c: { headerLines: string[]; hunks: string[][] }): FileSection {
  return {
    header: c.headerLines.join('\n'),
    hunks: c.hunks.map((h) => h.join('\n')),
  };
}

export interface HunkChunk {
  file: string;
  /** Index of this hunk within its file, stable across runs. */
  hunkIndex: number;
  /** A valid one-hunk unified diff (the file header plus the hunk). */
  text: string;
}

/**
 * Split a diff into one chunk per hunk, each a valid one-hunk diff carrying
 * its file header, with a stable (file, hunkIndex) identifier. This is the
 * granularity the per-hunk judge uses to localize a verdict to the hunk
 * that triggered it instead of flagging the whole diff.
 */
export function chunkUnifiedDiffByHunk(diff: string): HunkChunk[] {
  const out: HunkChunk[] = [];
  for (const section of splitFileSections(diff)) {
    const file = fileOf(section.header);
    section.hunks.forEach((hunk, hunkIndex) => {
      out.push({ file, hunkIndex, text: `${section.header}\n${hunk}\n` });
    });
  }
  return out;
}

function fileOf(header: string): string {
  const m = /^diff --git a\/(.+?) b\/(.+)$/m.exec(header);
  return m?.[2] ?? '<unknown>';
}

/**
 * Split a unified diff into chunks each at or under `maxChars` (best
 * effort: a single oversized hunk is its own chunk). Each chunk is a valid
 * unified diff. When the whole diff already fits, returns it unchanged as a
 * single element.
 */
export function chunkUnifiedDiff(diff: string, maxChars: number): string[] {
  if (diff.length <= maxChars) return [diff];
  const sections = splitFileSections(diff);
  if (sections.length === 0) return [diff.slice(0, maxChars)];
  const chunks: string[] = [];
  let buf = '';
  const flush = (): void => {
    if (buf.length > 0) {
      chunks.push(buf.endsWith('\n') ? buf : `${buf}\n`);
      buf = '';
    }
  };
  for (const section of sections) {
    for (const hunk of section.hunks) {
      const piece = `${section.header}\n${hunk}\n`;
      if (buf.length > 0 && buf.length + piece.length > maxChars) flush();
      if (piece.length > maxChars && buf.length === 0) {
        // Oversized single hunk: emit on its own rather than dropping it.
        chunks.push(piece.endsWith('\n') ? piece : `${piece}\n`);
        continue;
      }
      buf += piece;
    }
  }
  flush();
  return chunks.length > 0 ? chunks : [diff.slice(0, maxChars)];
}
