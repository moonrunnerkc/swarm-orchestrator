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
import parseDiff = require('parse-diff');

export interface UnifiedDiffApplyResult {
  applied: boolean;
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
  isCreate: boolean;
  isDelete: boolean;
  hunks: ParsedHunk[];
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/;

export function stripDiffPreamble(text: string): string {
  let s = text.replace(/```(?:diff|patch)?\s*\n?/gi, '');
  s = s.replace(/\n?```\s*/g, '\n');
  const m = /^---\s+\S/m.exec(s);
  if (!m) return text;
  return s.slice(m.index);
}

export function looksLikeUnifiedDiff(text: string): boolean {
  const stripped = stripDiffPreamble(text);
  return /^---\s+\S+\n\+\+\+\s+\S+\n@@\s/m.test(stripped);
}

/**
 * Convert a parse-diff `Change.content` value into the leading-marker form
 * the applier expects (` `, `-`, or `+` followed by the line body). parse-diff
 * keeps the marker on `content` already; we just normalize "no newline at end
 * of file" sentinels which the applier treats as informational.
 */
function changeToLine(change: parseDiff.Change): string | null {
  if (change.content.startsWith('\\')) return null;
  return change.content;
}

function toFilePatch(file: parseDiff.File): ParsedFilePatch {
  const isCreate = file.from === '/dev/null' || file.new === true;
  const isDelete = file.to === '/dev/null' || file.deleted === true;
  const oldPath = isCreate ? null : (file.from ?? null);
  const newPath = isDelete ? null : (file.to ?? null);
  const hunks: ParsedHunk[] = file.chunks.map((chunk) => {
    const lines: string[] = [];
    for (const change of chunk.changes) {
      const ln = changeToLine(change);
      if (ln !== null) lines.push(ln);
    }
    return {
      oldStart: chunk.oldStart,
      oldLines: chunk.oldLines,
      newStart: chunk.newStart,
      newLines: chunk.newLines,
      lines,
    };
  });
  return { oldPath, newPath, isCreate, isDelete, hunks };
}

/**
 * Enumerate repo-relative file paths a unified diff targets. Used by
 * `snapshotBeforeApply` to know which paths to hash before applying.
 * Pure function; does not touch the filesystem. Returns empty when the
 * input is not a unified diff.
 */
export function listAffectedPaths(diffText: string): readonly string[] {
  const trimmed = diffText.trim();
  if (trimmed === 'no-op' || trimmed === '"no-op"') return [];
  if (!looksLikeUnifiedDiff(trimmed)) return [];
  try {
    const patches = parseUnifiedDiff(trimmed);
    const paths = new Set<string>();
    for (const p of patches) {
      const target = p.newPath ?? p.oldPath;
      if (target) paths.add(target);
    }
    return [...paths];
  } catch {
    return [];
  }
}

/**
 * Parse a unified diff into one entry per file patch. Throws when the diff
 * is structurally malformed: missing `+++` after `---`, or a `@@` header
 * that does not match the strict range form. parse-diff itself is permissive
 * (silently skips garbage); the strict applier in front requires that
 * permissiveness be tightened back up so personas can't smuggle through a
 * fuzzy diff.
 */
export function parseUnifiedDiff(text: string): ParsedFilePatch[] {
  const stripped = stripDiffPreamble(text);
  const lines = stripped.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const ln = lines[i] ?? '';
    if (ln.startsWith('@@') && !HUNK_HEADER.test(ln)) {
      throw new Error(`unified diff: malformed hunk header at line ${i + 1}: '${ln}'`);
    }
    if (ln.startsWith('--- ')) {
      const next = lines[i + 1] ?? '';
      if (!next.startsWith('+++ ')) {
        throw new Error(
          `unified diff: expected '---' followed by '+++' at line ${i + 1}, got '${ln}' / '${next}'`,
        );
      }
    }
  }
  const files = parseDiff(stripped);
  return files.map(toFilePatch);
}

/**
 * Apply a parsed file patch to the repository. Strict context match: every
 * ` `/`-` line in the hunk must equal the corresponding source line at the
 * stated offset.
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
  const target = patch.newPath ?? patch.oldPath;
  if (!target) throw new Error('unified diff: modify patch with no path');
  const abs = resolveRepoRelative(repoRoot, target);
  const original = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
  const sourceLines = original.split('\n');
  // A trailing '\n' splits into an extra empty element we must preserve.
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
  const rel = path.relative(repoRoot, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`unified diff: target path ${relPath} escapes repo root ${repoRoot}`);
  }
  return abs;
}

function truncate(s: string): string {
  return s.length > 60 ? s.slice(0, 57) + '...' : s;
}

export interface ApplyUnifiedDiffOptions {
  /**
   * Repo-relative paths that this caller is forbidden from writing. Patches
   * that CREATE or DELETE such a path are silently skipped (recorded in
   * `skippedFiles`); modify-in-place patches are allowed, since they don't
   * stomp on the architect's body. Without this exemption every downstream
   * persona's legitimate edit to a file-must-exist path gets silently
   * dropped — the May 2026 eval failure mode.
   */
  readonly protectedPaths?: ReadonlySet<string>;
}

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
    if (
      target !== null &&
      options.protectedPaths?.has(target) &&
      (patch.isCreate || patch.isDelete)
    ) {
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
