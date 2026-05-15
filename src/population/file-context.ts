import * as fs from 'fs';
import * as path from 'path';

// 6 KB ≈ 1500 tokens — covers a typical controller/route file without
// dominating the prompt budget.
const FILE_CONTEXT_MAX_BYTES = 6 * 1024;
const TOTAL_FILE_CONTEXT_MAX_BYTES = 16 * 1024;

// Without inlining current file contents, personas guess at context
// lines and diffs hit "context mismatch" errors (May 2026 eval failure
// mode).
export function appendFileContext(
  lines: string[],
  repoRoot: string,
  paths: readonly string[],
): void {
  let remaining = TOTAL_FILE_CONTEXT_MAX_BYTES;
  const seen = new Set<string>();
  for (const relPath of paths) {
    if (remaining <= 0) break;
    if (seen.has(relPath)) continue;
    seen.add(relPath);
    let abs: string;
    try {
      abs = path.resolve(repoRoot, relPath);
    } catch {
      continue;
    }
    // Defense: reject paths that escape repoRoot via ../
    const rel = path.relative(repoRoot, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
    if (!fs.existsSync(abs)) continue;
    let body: string;
    try {
      body = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const truncated = body.length > FILE_CONTEXT_MAX_BYTES;
    const slice = truncated ? body.slice(0, FILE_CONTEXT_MAX_BYTES) : body;
    const byteCost = slice.length + 80;
    if (byteCost > remaining) continue;
    remaining -= byteCost;
    lines.push('');
    lines.push(`Current contents of ${relPath} (use these exact lines as diff context):`);
    lines.push('```');
    lines.push(slice + (truncated ? '\n[…truncated…]' : ''));
    lines.push('```');
  }
}
