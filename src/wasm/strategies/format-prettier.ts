/**
 * `format-prettier` strategy: format a file with prettier-style rules.
 *
 * Phase 5 ships an in-process formatter rather than shelling out to the
 * `prettier` binary. The §8 spec carves the formatter wrapper as
 * orchestration (when to run it, which files, on which obligations);
 * the actual formatting can be a native binary OR an in-process
 * transformation of equivalent shape. We pick in-process here because
 * the orchestrator's tests must run on machines without `prettier`
 * installed and because it makes the strategy zero-dependency.
 *
 * Supported rewrites (the deterministic subset that matters for v8
 * obligations):
 *   - normalize line endings to LF;
 *   - strip trailing whitespace from every non-blank line;
 *   - ensure exactly one trailing newline;
 *   - normalize indentation: convert leading tabs to two spaces.
 *   - JSON files: pretty-print with 2-space indent and a trailing LF.
 *
 * When the obligation file does not exist this strategy creates it
 * with empty body (post-format that becomes a single newline). The
 * §8 misclassification recovery path is unused here because every
 * file path is format-eligible.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ensureInsideRepoRoot } from '../wasm-runtime';
import type { DeterministicStrategy, StrategyContext, StrategyResult } from '../types';

const JSON_LIKE_EXTENSIONS = new Set(['.json', '.jsonc']);

/** Pure function: format a content string. Exported for tests. */
export function formatBody(content: string, relPath: string): string {
  const ext = path.extname(relPath).toLowerCase();
  if (JSON_LIKE_EXTENSIONS.has(ext) && content.trim().length > 0) {
    try {
      const parsed = JSON.parse(content) as unknown;
      return JSON.stringify(parsed, null, 2) + '\n';
    } catch {
      // Fall through to the generic path below; a non-JSON file under
      // a .json extension is unusual but the formatter still tidies it.
    }
  }
  const normalizedEol = content.replace(/\r\n?/g, '\n');
  const tabsToSpaces = normalizedEol.replace(/^(?:\t+)/gm, (m) => '  '.repeat(m.length));
  const trimmed = tabsToSpaces
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/u, ''))
    .join('\n');
  const stripped = trimmed.replace(/\n+$/u, '');
  return stripped + '\n';
}

/** The strategy implementation. */
export const formatPrettierStrategy: DeterministicStrategy = {
  name: 'format-prettier',
  description: 'Format a file with prettier-style rules (LF, trim, 2-space indent, JSON pretty-print).',
  handles: ['file-must-exist'] as const,
  async execute(ctx: StrategyContext): Promise<StrategyResult> {
    const obligation = ctx.obligation;
    if (obligation.type !== 'file-must-exist') {
      throw new Error(
        `format-prettier only handles file-must-exist; got ${obligation.type}`,
      );
    }
    const relPath = obligation.path;
    const abs = ensureInsideRepoRoot(ctx.repoRoot, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });

    const before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
    const after = formatBody(before, relPath);

    if (fs.existsSync(abs) && after === before) {
      return {
        applied: false,
        detail: `${relPath} already formatted`,
        filesAffected: [],
      };
    }
    fs.writeFileSync(abs, after, 'utf8');
    return {
      applied: true,
      detail: fs.existsSync(abs) && before.length > 0
        ? `formatted ${relPath}`
        : `created and formatted ${relPath}`,
      filesAffected: [relPath],
    };
  },
};
