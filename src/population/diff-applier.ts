import * as fs from 'fs';
import * as path from 'path';

/**
 * Phase 2 file-emit applier. The `architect` persona is asked to emit a
 * single file body wrapped in a fenced code block. This module extracts the
 * fenced body and writes it to the obligation's target path.
 *
 * No diff-format support yet (that lands when Phase 3 introduces the
 * implementer/verifier tournament patches). Phase 2 keeps the surface
 * minimal because the integration test only exercises file-must-exist.
 */
export interface FileEmitResult {
  applied: boolean;
  /** Absolute path written, or null when the response could not be parsed. */
  writtenPath: string | null;
  detail: string;
}

/**
 * Parse a fenced code block out of an assistant response. Tolerates
 * leading/trailing prose. Returns the body content (without the fences).
 * Returns null when no fenced block is found.
 */
export function extractFencedBody(text: string): string | null {
  const fence = /```[a-zA-Z0-9_+\-.]*\n([\s\S]*?)```/m;
  const match = text.match(fence);
  if (!match) return null;
  // The captured group ends with the newline before the closing fence; trim
  // exactly one trailing newline to keep file content faithful.
  return match[1] !== undefined ? match[1].replace(/\n$/, '') : null;
}

/**
 * Write a file body to the obligation's target path. Idempotent: writes
 * even if the file already exists (the population manager decides whether
 * to skip already-satisfied obligations via the predicate evaluator).
 */
export function writeFileObligation(
  repoRoot: string,
  relPath: string,
  body: string,
): FileEmitResult {
  if (path.isAbsolute(relPath)) {
    return {
      applied: false,
      writtenPath: null,
      detail: `target path ${relPath} is absolute; v8 contracts use repo-relative paths`,
    };
  }
  const abs = path.join(repoRoot, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  // Ensure file ends with a single trailing newline.
  const normalized = body.endsWith('\n') ? body : body + '\n';
  fs.writeFileSync(abs, normalized, 'utf8');
  return { applied: true, writtenPath: abs, detail: `wrote ${relPath}` };
}

/**
 * Persona response → on-disk file. Phase 2's only synthesis path: the
 * architect persona writes a single file when the obligation is
 * file-must-exist. Returns whether the apply step succeeded; the caller
 * runs verifier separately.
 */
export function applyFileEmit(
  repoRoot: string,
  relPath: string,
  responseText: string,
): FileEmitResult {
  const body = extractFencedBody(responseText);
  if (body === null) {
    // Treat the entire response as the file body when no fence is present.
    // This matches stub-session output, which never emits fences but is the
    // primary integration-test path for Phase 2.
    return writeFileObligation(repoRoot, relPath, responseText);
  }
  return writeFileObligation(repoRoot, relPath, body);
}
