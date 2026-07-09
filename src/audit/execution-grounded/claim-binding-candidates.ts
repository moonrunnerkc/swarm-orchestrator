// Deterministic existing-test candidate gathering for the Tier C claim-binding
// engine. The binder needs `ExistingTest` records (file, test name, referenced
// production symbols) to score a claim against. This module builds them from the
// provisioned head checkout with no model call: it takes the repo tests whose
// import closure reaches the PR's changed source (the tests that actually exercise
// the change), reads each, and pairs its test titles with the changed source's
// exported symbols. An arbiter may later RANK these candidates but never invents
// one; this is the deterministic floor the wiring supplies.

import { spawnSync } from 'child_process';
import * as path from 'path';
import { getLogger } from '../../logger';
import type { ExistingTest } from './claim-binding';
import { selectAffectedTestFiles } from './no-op-fix-restoration';
import { changedNonTestSourceFiles } from './test-restoration';
import { extractExportedSymbols } from './claim-changed-units';

const log = getLogger('audit:execution-grounded:claim-binding-candidates');

/** Default cap on emitted candidates so a large test file cannot blow the budget. */
export const DEFAULT_MAX_BINDING_CANDIDATES = 40;

/** Cross-language test-title extraction. Deliberately shallow (first-match per
 *  pattern, not a full parse): JS/TS `it`/`test`/`describe`, Python `def test_`,
 *  Go `func TestXxx`. Returns the distinct titles in source order. */
const TITLE_PATTERNS: readonly RegExp[] = [
  /\b(?:it|test|describe)\s*\(\s*(['"`])([^'"`]{1,200})\1/g,
  /\bdef\s+(test_[A-Za-z0-9_]{1,120})\s*\(/g,
  /\bfunc\s+(Test[A-Za-z0-9_]{1,120})\s*\(/g,
];

/** Pure: the distinct test titles in `source`, capped. */
export function extractTestTitles(source: string, cap = 20): string[] {
  const titles: string[] = [];
  const seen = new Set<string>();
  for (const pattern of TITLE_PATTERNS) {
    for (const m of source.matchAll(pattern)) {
      const title = (m[2] ?? m[1] ?? '').trim();
      if (title.length > 0 && !seen.has(title)) {
        seen.add(title);
        titles.push(title);
        if (titles.length >= cap) return titles;
      }
    }
  }
  return titles;
}

/** Read a file's text, or null when it cannot be read (workspace drift). */
function readFile(absPath: string): string | null {
  const res = spawnSync('cat', [absPath], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  return res.status === 0 && typeof res.stdout === 'string' ? res.stdout : null;
}

export interface GatherExistingTestsInput {
  prDiff: string;
  /** The provisioned head checkout (post-PR); the repo root for closure + reads. */
  postWorkspacePath: string;
  maxCandidates?: number;
}

/**
 * Gather the existing-test candidates the claim could bind to, deterministically.
 * The candidate set is the repo tests whose import closure reaches a changed
 * source file; each candidate's `referencedSymbols` are the changed source's
 * exported symbols (TS/JS) plus the changed file basenames, so the binder can
 * match them against the claim text. One `ExistingTest` per (file, title) pair.
 * No model call; never throws (an unreadable file is skipped).
 *
 * @param input the PR diff and the provisioned head checkout.
 * @returns the scored-elsewhere candidate tests, capped; empty when the diff
 *   changed no non-test source or no repo test closes over it.
 */
export function gatherExistingTests(input: GatherExistingTestsInput): ExistingTest[] {
  const changed = changedNonTestSourceFiles(input.prDiff);
  if (changed.length === 0) return [];
  const affected = selectAffectedTestFiles(input.postWorkspacePath, changed);
  if (affected.affected.length === 0) return [];

  // Referenced symbols the claim might name: the changed files' exported symbols
  // (TS/JS) and their basenames (language-agnostic). Shared across the affected
  // tests, because each affected test closes over at least one changed file.
  const symbols = new Set<string>();
  for (const rel of changed) {
    symbols.add(path.basename(rel).replace(/\.[^.]+$/, ''));
    const text = readFile(path.join(input.postWorkspacePath, rel));
    if (text !== null) for (const s of extractExportedSymbols(text, rel)) symbols.add(s);
  }
  const referencedSymbols = [...symbols].sort();

  const cap = input.maxCandidates ?? DEFAULT_MAX_BINDING_CANDIDATES;
  const candidates: ExistingTest[] = [];
  for (const testFile of affected.affected) {
    const text = readFile(path.join(input.postWorkspacePath, testFile));
    if (text === null) {
      log.debug(`could not read affected test ${testFile}; skipping`);
      continue;
    }
    const titles = extractTestTitles(text);
    // A test file with no recognizable title still binds by file-name/symbols.
    const names = titles.length > 0 ? titles : [path.basename(testFile)];
    for (const testName of names) {
      candidates.push({ file: testFile, testName, referencedSymbols });
      if (candidates.length >= cap) return candidates;
    }
  }
  return candidates;
}
