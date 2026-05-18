/**
 * Whole-file replacement applier. The unified-diff format requires
 * byte-exact context-line matching against the on-disk file; LLMs
 * routinely fail at this (they paraphrase context lines, invent
 * surrounding code, or use the wrong indentation). The whole-file
 * format sidesteps the entire problem: the persona writes the FULL
 * intended contents of one or more files, and the applier replaces
 * each named file's contents wholesale.
 *
 * Wire format (persona response):
 *
 *   <<<FILE src/controllers/user.controller.js
 *   const x = 1;
 *   ...full file content...
 *   FILE>>>
 *
 *   <<<FILE src/routes/v1/user.route.js
 *   ...full file content...
 *   FILE>>>
 *
 * Each block delimits one file write. The path on the opening marker
 * is repo-relative. The body lines (between `<<<FILE <path>` and
 * `FILE>>>`) are written verbatim — no fence stripping, no context
 * inference. Multiple blocks may appear in a single response.
 *
 * Safety guards:
 *   - Paths must stay inside repoRoot (path.relative gates against ../).
 *   - protectedPaths (file-must-exist owned) cannot be overwritten by
 *     whole-file blocks — the architect's body is preserved. This is
 *     parallel to the unified-diff CREATE-block protection.
 *   - Truncation guard: if a block's body is dramatically shorter than
 *     the existing file (< 20% of original lines AND original was
 *     > 30 lines), reject the block. Real edits rarely halve a file;
 *     a hallucinated truncated body is more likely.
 */

import * as fs from 'fs';
import * as path from 'path';

interface WholeFileBlock {
  /** Repo-relative path from the `<<<FILE <path>` marker. */
  readonly relPath: string;
  /** Verbatim body (the file's new contents). */
  readonly body: string;
}

export interface ApplyWholeFileOptions {
  /**
   * Repo-relative paths that may not be overwritten. Mirrors the
   * unified-diff `protectedPaths` semantics so the architect's
   * file-must-exist bodies are not stomped by a later persona.
   */
  readonly protectedPaths?: ReadonlySet<string>;
}

export interface WholeFileApplyResult {
  applied: boolean;
  changedFiles: string[];
  detail: string;
}

/** Detect whether the response contains any whole-file blocks. */
export function looksLikeWholeFileResponse(text: string): boolean {
  return /^<<<FILE\s+\S+/m.test(text);
}

/**
 * Parse whole-file blocks out of a persona response. Returns one entry
 * per recognised block. Tolerant of leading prose or fence wrappers —
 * the regex anchors on the `<<<FILE` marker only. Throws when a block
 * is unterminated (no `FILE>>>` close marker after an opener).
 */
export function parseWholeFileBlocks(text: string): WholeFileBlock[] {
  const blocks: WholeFileBlock[] = [];
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const m = /^<<<FILE\s+(\S+)\s*$/.exec(line);
    if (!m) {
      i += 1;
      continue;
    }
    const relPath = m[1] ?? '';
    const bodyStart = i + 1;
    let close = -1;
    for (let j = bodyStart; j < lines.length; j += 1) {
      if (lines[j] === 'FILE>>>' || lines[j]?.trimEnd() === 'FILE>>>') {
        close = j;
        break;
      }
    }
    if (close === -1) {
      throw new Error(
        `whole-file block opened at line ${i + 1} (path ${relPath}) was never closed with FILE>>>`,
      );
    }
    const body = lines.slice(bodyStart, close).join('\n');
    blocks.push({ relPath, body });
    i = close + 1;
  }
  return blocks;
}

/**
 * Apply a whole-file response to the workspace. Writes each block's
 * body to the named repo-relative path. Returns the same shape as
 * `applyUnifiedDiff` so callers can treat the two appliers
 * interchangeably.
 */
export function applyWholeFileResponse(
  repoRoot: string,
  responseText: string,
  options: ApplyWholeFileOptions = {},
): WholeFileApplyResult {
  const blocks = parseWholeFileBlocks(responseText);
  if (blocks.length === 0) {
    return {
      applied: false,
      changedFiles: [],
      detail: 'response contained no whole-file blocks',
    };
  }
  const changedFiles: string[] = [];
  const skippedFiles: string[] = [];
  const rejectedFiles: string[] = [];
  for (const block of blocks) {
    if (path.isAbsolute(block.relPath)) {
      throw new Error(
        `whole-file block targets absolute path ${block.relPath}; only repo-relative paths are allowed`,
      );
    }
    const abs = path.resolve(repoRoot, block.relPath);
    const rel = path.relative(repoRoot, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(
        `whole-file block path ${block.relPath} escapes repo root ${repoRoot}`,
      );
    }
    if (options.protectedPaths?.has(block.relPath)) {
      skippedFiles.push(block.relPath);
      continue;
    }
    // Truncation guard.
    if (fs.existsSync(abs)) {
      const existing = fs.readFileSync(abs, 'utf8');
      const existingLines = existing.split('\n').length;
      const newLines = block.body.split('\n').length;
      if (existingLines > 30 && newLines < existingLines * 0.2) {
        rejectedFiles.push(
          `${block.relPath} (truncation guard: new=${newLines} lines, existing=${existingLines} lines)`,
        );
        continue;
      }
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(
      abs,
      block.body.endsWith('\n') ? block.body : block.body + '\n',
      'utf8',
    );
    changedFiles.push(block.relPath);
  }
  let detail: string;
  if (changedFiles.length === 0 && skippedFiles.length === 0 && rejectedFiles.length === 0) {
    detail = 'parsed whole-file blocks but wrote 0 files';
  } else {
    const parts: string[] = [];
    if (changedFiles.length > 0) parts.push(`wrote ${changedFiles.length} file(s)`);
    if (skippedFiles.length > 0) {
      parts.push(`skipped ${skippedFiles.length} protected: ${skippedFiles.join(', ')}`);
    }
    if (rejectedFiles.length > 0) {
      parts.push(`rejected ${rejectedFiles.length} by truncation guard: ${rejectedFiles.join('; ')}`);
    }
    detail = parts.join('; ');
  }
  return {
    applied: changedFiles.length > 0,
    changedFiles,
    detail,
  };
}
