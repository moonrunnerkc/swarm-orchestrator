// Hunk-aware chunking for the judge. The judge used to head-truncate any
// diff over its context budget, so a defect in the tail of a large PR was
// invisible to it. This splits a diff into chunks that each stay under the
// budget, grouping whole hunks and repeating each file's header in every
// chunk that carries its hunks, so each chunk is independently parseable.
// A single hunk larger than the budget is split into valid sub-hunks with
// recomputed @@ headers: the judge reads diffs, it never applies them, so
// a line-accurate sub-hunk loses nothing. (Passing the oversized hunk
// through whole, the previous behavior, made the model provider truncate
// it silently, which is exactly the tail-blindness this module exists to
// prevent; the agent corpus hit that with 421k-char single-hunk bundles.)

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
        for (const sub of splitOversizedHunk(section.header, hunk, maxChars)) {
          chunks.push(sub.endsWith('\n') ? sub : `${sub}\n`);
        }
        continue;
      }
      buf += piece;
    }
  }
  flush();
  return chunks.length > 0 ? chunks : [diff.slice(0, maxChars)];
}

/**
 * Split one hunk that exceeds `maxChars` into valid sub-hunks, each carrying
 * the file header and a recomputed `@@ -oldStart,oldCount +newStart,newCount @@`
 * line. Splits only at line boundaries and keeps `\ No newline at end of
 * file` markers attached to the line they annotate. A single line longer
 * than the budget (a minified bundle on one line) is cut at the budget
 * with an explicit truncation marker: cutting here keeps the chunk inside
 * the model's context so the prompt scaffold survives, where an
 * over-context prompt makes the provider truncate from the front and can
 * silently eat the question itself.
 */
function splitOversizedHunk(header: string, hunk: string, maxChars: number): string[] {
  const lines = hunk.split('\n');
  const headerLine = lines[0] ?? '';
  const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(headerLine);
  if (m === null) {
    // Unparseable hunk header: fall back to the whole piece rather than
    // emitting sub-hunks with invented line numbers.
    return [`${header}\n${hunk}`];
  }
  let oldStart = Number(m[1]);
  let newStart = Number(m[2]);
  const body = lines.slice(1);
  // A trailing empty entry is the split('\n') artifact of the hunk's final
  // newline, not a diff line; counting it as context skews the line math.
  while (body.length > 0 && body[body.length - 1] === '') body.pop();
  // Room left for body lines once the file header and a worst-case-size
  // recomputed hunk header are spent. 64 chars covers any realistic
  // `@@ -start,count +start,count @@` line regardless of how short the
  // original header was.
  const overhead = header.length + 64;
  const budget = Math.max(maxChars - overhead, 1);

  const out: string[] = [];
  let win: string[] = [];
  let winChars = 0;
  let oldCount = 0;
  let newCount = 0;

  const flushWin = (): void => {
    if (win.length === 0) return;
    const subHeader = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
    out.push(`${header}\n${subHeader}\n${win.join('\n')}`);
    oldStart += oldCount;
    newStart += newCount;
    win = [];
    winChars = 0;
    oldCount = 0;
    newCount = 0;
  };

  const TRUNCATION_MARKER = ' …[diff-chunker: line truncated at budget]';
  for (let i = 0; i < body.length; i += 1) {
    let line = body[i] ?? '';
    if (line.length > budget) {
      line = line.slice(0, Math.max(budget - TRUNCATION_MARKER.length, 1)) + TRUNCATION_MARKER;
    }
    // A no-newline marker annotates the previous line; never lead with it.
    const splittable = !line.startsWith('\\');
    if (splittable && win.length > 0 && winChars + line.length + 1 > budget) flushWin();
    win.push(line);
    winChars += line.length + 1;
    if (line.startsWith('-')) oldCount += 1;
    else if (line.startsWith('+')) newCount += 1;
    else if (!line.startsWith('\\')) {
      oldCount += 1;
      newCount += 1;
    }
  }
  flushWin();
  return out.length > 0 ? out : [`${header}\n${hunk}`];
}
