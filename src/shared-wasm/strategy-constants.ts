/**
 * Strategy-name constant and scaffold-template lookup shared between
 * the contract module (auto-tagger, compiler) and the wasm module
 * (strategy registry). Moving these here breaks the circular dependency
 * between contract and wasm.
 */

import * as path from 'path';

/** Names of the three first-party strategies, in registration order. */
export const DEFAULT_STRATEGY_NAMES = [
  'scaffold-template',
  'import-sort',
  'format-prettier',
] as const;

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

function resolveTemplate(relPath: string): string | null {
  const base = path.basename(relPath);
  if (BASENAME_TEMPLATES[base] !== undefined) return BASENAME_TEMPLATES[base];
  const ext = path.extname(relPath);
  if (ext && EXTENSION_TEMPLATES[ext] !== undefined) return EXTENSION_TEMPLATES[ext];
  return null;
}

/** True when a template can satisfy the given path. Used by the auto-tagger. */
export function hasTemplateFor(relPath: string): boolean {
  return resolveTemplate(relPath) !== null;
}

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

/** Test/inspection helper: list the basenames currently registered. */
export function listTemplateKeys(): { basenames: string[]; extensions: string[] } {
  return {
    basenames: Object.keys(BASENAME_TEMPLATES).slice().sort(),
    extensions: Object.keys(EXTENSION_TEMPLATES).slice().sort(),
  };
}

/**
 * Resolve a template for the given path. Returns the template body or null.
 * Exported for use by the scaffold-template strategy implementation.
 */
export function getTemplate(relPath: string): string | null {
  return resolveTemplate(relPath);
}

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
  return ['# Project', '', 'Placeholder README scaffolded by Phase 5 deterministic floor.'].join('\n');
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