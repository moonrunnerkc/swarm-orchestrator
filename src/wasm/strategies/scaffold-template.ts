/**
 * `scaffold-template` strategy: create a file from a registered
 * boilerplate template. Template selection is keyed by the basename or
 * extension of the obligation's path. When no template matches the
 * obligation reroutes to synthesis (impl guide §8 misclassification
 * recovery).
 *
 * Phase 5 ships a small in-repo template set covering the boilerplate
 * file types the §8 spec calls out (license headers, file naming
 * conventions, scaffolds). Additional templates are registered via
 * `registerTemplate`.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ObligationV1 } from '../../contract/types';
import { ensureInsideRepoRoot } from '../wasm-runtime';
import type { DeterministicStrategy, StrategyContext, StrategyResult } from '../types';

/** A template body keyed by an exact basename match (e.g. "LICENSE"). */
const BASENAME_TEMPLATES: Record<string, string> = {
  LICENSE: licenseTemplate(),
  '.gitignore': gitignoreTemplate(),
  '.editorconfig': editorconfigTemplate(),
  'README.md': readmeTemplate(),
  'CHANGELOG.md': changelogTemplate(),
};

/** A template body keyed by extension (e.g. ".md"). */
const EXTENSION_TEMPLATES: Record<string, string> = {
  '.md': '# Placeholder\n\nThis file is a Phase 5 deterministic scaffold.\n',
  '.txt': 'Placeholder text.\n',
};

/**
 * Register an additional template at runtime. Useful for users who
 * want to extend the strategy without forking the source tree.
 */
export function registerTemplate(
  key: { kind: 'basename' | 'extension'; value: string },
  body: string,
): void {
  if (key.kind === 'basename') BASENAME_TEMPLATES[key.value] = body;
  else EXTENSION_TEMPLATES[key.value] = body;
}

/** True when a template can satisfy the given path. Used by the auto-tagger. */
export function hasTemplateFor(relPath: string): boolean {
  return resolveTemplate(relPath) !== null;
}

function resolveTemplate(relPath: string): string | null {
  const base = path.basename(relPath);
  if (BASENAME_TEMPLATES[base] !== undefined) return BASENAME_TEMPLATES[base];
  const ext = path.extname(relPath);
  if (ext && EXTENSION_TEMPLATES[ext] !== undefined) return EXTENSION_TEMPLATES[ext];
  return null;
}

/** The strategy implementation. */
export const scaffoldTemplateStrategy: DeterministicStrategy = {
  name: 'scaffold-template',
  description: 'Create a file from a registered boilerplate template.',
  handles: ['file-must-exist'] as const,
  async execute(ctx: StrategyContext): Promise<StrategyResult> {
    const obligation = ctx.obligation;
    if (obligation.type !== 'file-must-exist') {
      throw new Error(
        `scaffold-template only handles file-must-exist; got ${obligation.type}`,
      );
    }
    const relPath = obligation.path;
    const template = resolveTemplate(relPath);
    if (template === null) {
      throw new Error(
        `no template registered for ${relPath} (basename or extension lookup miss)`,
      );
    }
    const abs = ensureInsideRepoRoot(ctx.repoRoot, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (fs.existsSync(abs)) {
      return {
        applied: false,
        detail: `${relPath} already exists; scaffold-template is non-destructive`,
        filesAffected: [],
      };
    }
    const body = template.endsWith('\n') ? template : template + '\n';
    fs.writeFileSync(abs, body, 'utf8');
    return {
      applied: true,
      detail: `wrote ${relPath} from registered template`,
      filesAffected: [relPath],
    };
  },
};

function licenseTemplate(): string {
  return [
    'ISC License',
    '',
    'Copyright (c) <year> <copyright holders>',
    '',
    'Permission to use, copy, modify, and/or distribute this software for any',
    'purpose with or without fee is hereby granted, provided that the above',
    'copyright notice and this permission notice appear in all copies.',
    '',
    'THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES',
    'WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF',
    'MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR',
    'ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES',
    'WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN',
    'ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF',
    'OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.',
  ].join('\n');
}

function gitignoreTemplate(): string {
  return ['node_modules/', 'dist/', 'coverage/', '.env', '.env.*', '*.log'].join('\n');
}

function editorconfigTemplate(): string {
  return [
    'root = true',
    '',
    '[*]',
    'indent_style = space',
    'indent_size = 2',
    'end_of_line = lf',
    'charset = utf-8',
    'trim_trailing_whitespace = true',
    'insert_final_newline = true',
    '',
    '[*.md]',
    'trim_trailing_whitespace = false',
    '',
    '[Makefile]',
    'indent_style = tab',
  ].join('\n');
}

function readmeTemplate(): string {
  return ['# Project', '', 'Placeholder README scaffolded by Phase 5 deterministic floor.'].join(
    '\n',
  );
}

function changelogTemplate(): string {
  return [
    '# Changelog',
    '',
    'All notable changes to this project will be documented in this file.',
    '',
    '## [Unreleased]',
  ].join('\n');
}

/** Test/inspection helper: list the basenames currently registered. */
export function listTemplateKeys(): { basenames: string[]; extensions: string[] } {
  return {
    basenames: Object.keys(BASENAME_TEMPLATES).slice().sort(),
    extensions: Object.keys(EXTENSION_TEMPLATES).slice().sort(),
  };
}

/** Type guard: confirm the obligation is one this strategy can take on. */
export function canScaffold(o: ObligationV1): boolean {
  return o.type === 'file-must-exist' && hasTemplateFor(o.path);
}
