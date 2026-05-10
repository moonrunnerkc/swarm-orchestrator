/**
 * Phase 3 unified-diff applier. The implementer/verifier personas emit
 * unified diffs against repo root for build/test obligations; this module
 * parses and applies them. Phase 2's `applyFileEmit` (fenced single-file
 * body) is preserved untouched; the tournament harness picks the
 * applier based on the persona's role.
 *
 * Scope:
 *   - Handles unified-diff format produced by `git diff` / `diff -u`.
 *   - Honors `--- a/old` / `+++ b/new` headers; treats `/dev/null` as
 *     "create" when on the old side and "delete" when on the new side.
 *   - Applies hunks against the on-disk pre-image, line-anchored. Strict
 *     match on the `@@` ranges; refuses to apply if context lines do not
 *     match the file exactly.
 *
 * Out of scope:
 *   - Binary diffs, rename detection, fuzz matching. The tournament
 *     verifier downscores candidates that produce malformed diffs, so the
 *     applier deliberately fails fast rather than guessing.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface UnifiedDiffApplyResult {
  applied: boolean;
  /** Repo-relative paths that were created, modified, or deleted. */
  changedFiles: string[];
  detail: string;
}

interface ParsedHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Body lines including leading ` `, `-`, or `+` markers. */
  lines: string[];
}

interface ParsedFilePatch {
  oldPath: string | null;
  newPath: string | null;
  /** True when the patch creates a new file (`--- /dev/null`). */
  isCreate: boolean;
  /** True when the patch deletes a file (`+++ /dev/null`). */
  isDelete: boolean;
  hunks: ParsedHunk[];
}

/** Internal representation of a parsed diff header plus its line index. */
interface DiffHeader {
  oldPath: string | null;
  newPath: string | null;
  isCreate: boolean;
  isDelete: boolean;
  /** 0-based line index of the `---` header in the stripped line array. */
  headerLineIndex: number;
}

/**
 * Detect whether a response body looks like a unified diff. Used by the
 * population manager to decide between `applyFileEmit` (fenced) and
 * `applyUnifiedDiff` (patch).
 */
export function looksLikeUnifiedDiff(text: string): boolean {
  // Strip optional fences.
  const stripped = text
    .replace(/^```(?:diff|patch)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '');
  return /^---\s+\S+\n\+\+\+\s+\S+\n@@\s/m.test(stripped);
}

/**
 * Strip optional markdown fences and split into lines.
 */
function stripAndSplit(text: string): string[] {
  const stripped = text
    .replace(/^```(?:diff|patch)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '');
  return stripped.split('\n');
}

/**
 * Parse the `---` / `+++` headers from a unified diff. Returns one entry
 * per file patch, carrying the parsed paths and the 0-based line index of
 * the `---` header so callers can slice the hunk body that follows.
 * Throws when headers are malformed.
 */
function parseDiffHeaders(lines: readonly string[]): DiffHeader[] {
  const headers: DiffHeader[] = [];
  let i = 0;
  while (i < lines.length) {
    while (i < lines.length && !lines[i]?.startsWith('--- ')) {
      i += 1;
    }
    if (i >= lines.length) break;
    const oldHeader = lines[i] ?? '';
    const newHeader = lines[i + 1] ?? '';
    if (!oldHeader.startsWith('--- ') || !newHeader.startsWith('+++ ')) {
      throw new Error(
        `unified diff: expected '---' followed by '+++' at line ${i + 1}, got '${oldHeader}' / '${newHeader}'`,
      );
    }
    const oldRaw = oldHeader.slice(4).split('\t')[0]?.trim() ?? '';
    const newRaw = newHeader.slice(4).split('\t')[0]?.trim() ?? '';
    const isCreate = oldRaw === '/dev/null';
    const isDelete = newRaw === '/dev/null';
    const oldPath = isCreate ? null : stripPathPrefix(oldRaw);
    const newPath = isDelete ? null : stripPathPrefix(newRaw);
    headers.push({ oldPath, newPath, isCreate, isDelete, headerLineIndex: i });
    i += 2;
    // Skip hunks to reach the next header.
    while (i < lines.length && lines[i]?.startsWith('@@')) {
      i += 1;
      while (i < lines.length) {
        const ln = lines[i] ?? '';
        if (ln.startsWith('@@') || ln.startsWith('--- ') || ln.startsWith('diff ')) break;
        if (ln.length === 0 && i === lines.length - 1) {
          i += 1;
          break;
        }
        const tag = ln[0];
        if (tag === ' ' || tag === '-' || tag === '+' || tag === '\\') {
          i += 1;
          continue;
        }
        if (tag === undefined || ln.length === 0) {
          i += 1;
          break;
        }
        i += 1;
        break;
      }
    }
  }
  return headers;
}

/**
 * Enumerate repo-relative file paths a unified diff targets. Used by
 * `snapshotBeforeApply` to know which paths to hash before applying.
 * Pure function; does not touch the filesystem.
 *
 * Returns an empty array when the input is not a unified diff. Caller
 * treats empty paths as "nothing to snapshot" and skips the ledger
 * write.
 */
export function listAffectedPaths(diffText: string): readonly string[] {
  const trimmed = diffText.trim();
  if (trimmed === 'no-op' || trimmed === '"no-op"') {
    return [];
  }
  if (!looksLikeUnifiedDiff(trimmed)) {
    return [];
  }
  try {
    const lines = stripAndSplit(trimmed);
    const headers = parseDiffHeaders(lines);
    const paths = new Set<string>();
    for (const h of headers) {
      const target = h.newPath ?? h.oldPath;
      if (target) paths.add(target);
    }
    return [...paths];
  } catch {
    return [];
  }
}

/**
 * Parse a unified diff. Returns one entry per file patch. Throws when the
 * diff is structurally malformed (missing headers, hunk count mismatch,
 * unexpected leading characters).
 */
export function parseUnifiedDiff(text: string): ParsedFilePatch[] {
  const lines = stripAndSplit(text);
  const headers = parseDiffHeaders(lines);
  const patches: ParsedFilePatch[] = [];

  for (let h = 0; h < headers.length; h += 1) {
    const header = headers[h];
    if (!header) continue;
    const nextHeader = headers[h + 1];
    const bodyEnd = nextHeader ? nextHeader.headerLineIndex : lines.length;
    let i = header.headerLineIndex + 2;
    const hunks: ParsedHunk[] = [];
    while (i < bodyEnd && lines[i]?.startsWith('@@')) {
      const headerLine = lines[i] ?? '';
      const m = headerLine.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (!m) {
        throw new Error(`unified diff: malformed hunk header at line ${i + 1}: '${headerLine}'`);
      }
      const oldStart = Number.parseInt(m[1] ?? '1', 10);
      const oldLines = m[2] !== undefined ? Number.parseInt(m[2], 10) : 1;
      const newStart = Number.parseInt(m[3] ?? '1', 10);
      const newLines = m[4] !== undefined ? Number.parseInt(m[4], 10) : 1;
      i += 1;
      const body: string[] = [];
      let oldSeen = 0;
      let newSeen = 0;
      while (i < bodyEnd) {
        const ln = lines[i] ?? '';
        if (ln.startsWith('@@') || ln.startsWith('--- ') || ln.startsWith('diff ')) break;
        // Tolerate trailing blank line after final hunk.
        if (ln.length === 0 && i === bodyEnd - 1) {
          i += 1;
          break;
        }
        const tag = ln[0];
        if (tag === ' ') {
          oldSeen += 1;
          newSeen += 1;
        } else if (tag === '-') {
          oldSeen += 1;
        } else if (tag === '+') {
          newSeen += 1;
        } else if (tag === '\\') {
          // "\ No newline at end of file" — informational; ignore.
        } else if (tag === undefined || ln.length === 0) {
          // Blank lines inside hunks are valid context (single space line)
          // but here we treat truly-empty lines as terminators.
          break;
        } else {
          throw new Error(
            `unified diff: unexpected hunk line at ${i + 1}: '${ln.slice(0, 40)}'`,
          );
        }
        body.push(ln);
        i += 1;
        if (oldSeen >= oldLines && newSeen >= newLines) break;
      }
      hunks.push({ oldStart, oldLines, newStart, newLines, lines: body });
    }
    patches.push({
      oldPath: header.oldPath,
      newPath: header.newPath,
      isCreate: header.isCreate,
      isDelete: header.isDelete,
      hunks,
    });
  }
  return patches;
}

/**
 * Strip the conventional `a/` / `b/` prefix git emits. Leaves bare paths
 * (no prefix) intact. `/dev/null` callers don't reach this function.
 */
function stripPathPrefix(raw: string): string {
  if (raw.startsWith('a/') || raw.startsWith('b/')) return raw.slice(2);
  return raw;
}

/**
 * Apply a parsed file patch to the repository. Strict context match: every
 * ` `/`-` line in the hunk must equal the corresponding source line at the
 * stated offset. The applier writes the result to disk and returns the
 * affected repo-relative path.
 */
function applyFilePatch(repoRoot: string, patch: ParsedFilePatch): string {
  if (patch.isDelete) {
    if (!patch.oldPath) throw new Error('unified diff: delete with no oldPath');
    const abs = resolveRepoRelative(repoRoot, patch.oldPath);
    if (fs.existsSync(abs)) fs.rmSync(abs);
    return patch.oldPath;
  }
  if (patch.isCreate) {
    if (!patch.newPath) throw new Error('unified diff: create with no newPath');
    if (patch.hunks.length !== 1) {
      throw new Error(
        `unified diff: create patch for ${patch.newPath} must have exactly one hunk; got ${patch.hunks.length}`,
      );
    }
    const hunk = patch.hunks[0];
    if (!hunk) throw new Error('unified diff: create with no hunk');
    const out: string[] = [];
    for (const ln of hunk.lines) {
      if (ln.startsWith('+')) out.push(ln.slice(1));
      else if (ln.startsWith(' ')) out.push(ln.slice(1));
      else if (ln.startsWith('-')) {
        throw new Error(`unified diff: create patch for ${patch.newPath} contains a '-' line`);
      }
    }
    const abs = resolveRepoRelative(repoRoot, patch.newPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, out.join('\n') + (out.length > 0 ? '\n' : ''), 'utf8');
    return patch.newPath;
  }
  // Modify in place.
  const target = patch.newPath ?? patch.oldPath;
  if (!target) throw new Error('unified diff: modify patch with no path');
  const abs = resolveRepoRelative(repoRoot, target);
  const original = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
  const sourceLines = original.split('\n');
  // Trailing-newline bookkeeping: a file ending with '\n' splits into one
  // extra empty element we need to preserve.
  const hadTrailingNewline = original.endsWith('\n');
  const working = hadTrailingNewline ? sourceLines.slice(0, -1) : sourceLines;
  const result: string[] = [...working];
  // Apply hunks back-to-front so earlier hunks' offsets stay valid.
  const hunks = [...patch.hunks].sort((a, b) => b.oldStart - a.oldStart);
  for (const hunk of hunks) {
    const startIdx = hunk.oldStart - 1;
    const expected: string[] = [];
    const replacement: string[] = [];
    for (const ln of hunk.lines) {
      if (ln.startsWith(' ')) {
        expected.push(ln.slice(1));
        replacement.push(ln.slice(1));
      } else if (ln.startsWith('-')) {
        expected.push(ln.slice(1));
      } else if (ln.startsWith('+')) {
        replacement.push(ln.slice(1));
      }
    }
    for (let k = 0; k < expected.length; k += 1) {
      const want = expected[k];
      const got = result[startIdx + k];
      if (got !== want) {
        throw new Error(
          `unified diff: context mismatch in ${target} at line ${startIdx + k + 1}: expected '${truncate(want ?? '')}', got '${truncate(got ?? '')}'`,
        );
      }
    }
    result.splice(startIdx, expected.length, ...replacement);
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(
    abs,
    result.join('\n') + (result.length > 0 || hadTrailingNewline ? '\n' : ''),
    'utf8',
  );
  return target;
}

function resolveRepoRelative(repoRoot: string, relPath: string): string {
  if (path.isAbsolute(relPath)) {
    throw new Error(
      `unified diff: target path ${relPath} is absolute; v8 patches must be repo-relative`,
    );
  }
  const abs = path.join(repoRoot, relPath);
  // Defensive: refuse to escape repo root via ..
  const rel = path.relative(repoRoot, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`unified diff: target path ${relPath} escapes repo root ${repoRoot}`);
  }
  return abs;
}

function truncate(s: string): string {
  return s.length > 60 ? s.slice(0, 57) + '...' : s;
}

/**
 * Options for `applyUnifiedDiff`.
 */
export interface ApplyUnifiedDiffOptions {
  /**
   * Repo-relative paths that this caller is forbidden from writing. Patches
   * targeting any of these paths are silently skipped (recorded in
   * `skippedFiles`). Use this when an upstream `file-must-exist` obligation
   * owns a path: subsequent personas (security-reviewer satisfying a
   * property, verifier satisfying test-must-pass) can otherwise emit a
   * "let me also create the file" diff and overwrite the architect's body
   * with their own — sometimes truncated — content.
   */
  readonly protectedPaths?: ReadonlySet<string>;
}

/**
 * Apply a unified-diff response body. Tolerates `no-op` (returns
 * `{applied: false, changedFiles: [], detail: 'no-op'}`). Throws when the
 * diff is malformed or hunks fail to apply; the population manager
 * surfaces the error as a verification failure.
 */
export function applyUnifiedDiff(
  repoRoot: string,
  responseText: string,
  options: ApplyUnifiedDiffOptions = {},
): UnifiedDiffApplyResult {
  const trimmed = responseText.trim();
  if (trimmed === 'no-op' || trimmed === '"no-op"') {
    return { applied: false, changedFiles: [], detail: 'no-op' };
  }
  if (!looksLikeUnifiedDiff(trimmed)) {
    return {
      applied: false,
      changedFiles: [],
      detail: 'response is not a unified diff and not "no-op"',
    };
  }
  const patches = parseUnifiedDiff(trimmed);
  const changedFiles: string[] = [];
  const skippedFiles: string[] = [];
  for (const patch of patches) {
    const target = patch.newPath ?? patch.oldPath;
    if (target !== null && options.protectedPaths?.has(target)) {
      skippedFiles.push(target);
      continue;
    }
    const written = applyFilePatch(repoRoot, patch);
    changedFiles.push(written);
  }
  let detail: string;
  if (changedFiles.length === 0 && skippedFiles.length === 0) {
    detail = 'parsed diff but no files changed';
  } else if (skippedFiles.length === 0) {
    detail = `applied ${patches.length} patch(es) over ${changedFiles.length} file(s)`;
  } else {
    detail =
      `applied ${changedFiles.length} patch(es); skipped ${skippedFiles.length} ` +
      `patch(es) targeting protected path(s): ${[...new Set(skippedFiles)].join(', ')}`;
  }
  return {
    applied: changedFiles.length > 0,
    changedFiles,
    detail,
  };
}
