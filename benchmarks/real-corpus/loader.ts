// Loads PR-shaped corpus entries from `benchmarks/real-corpus/raw/`.
//
// Layout: `raw/<vendor>/<owner>-<repo>-pr<number>.json` (the file the
// collector writes) plus a sibling `raw/<vendor>/<owner>-<repo>-pr<number>.diff`
// (the vendored fallback diff). The loader reads only the JSON; the
// diff is loaded lazily at score-time so the loader stays cheap.
//
// Mirrors the shape of `benchmarks/falsification-corpus/loader.ts`:
// returns `UnlabeledPrCorpusEntry[]`, throws `PrCorpusLoaderError` with
// a list of structural issues when one or more files are malformed.

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  isUnlabeledPrEntry,
  validateUnlabeledPrEntry,
  type PrCorpusEntry,
  type UnlabeledPrCorpusEntry,
  type GroundTruthLabel,
} from './schema';
import { readLabel } from '../falsification-corpus/label-store';

export interface PrCorpusStructureIssue {
  path: string;
  reason: string;
  remediation: string;
}

/** Error thrown when one or more raw/ entries are unrunnable. */
export class PrCorpusLoaderError extends Error {
  readonly issues: readonly PrCorpusStructureIssue[];

  constructor(issues: readonly PrCorpusStructureIssue[]) {
    super(formatIssueMessage(issues));
    this.name = 'PrCorpusLoaderError';
    this.issues = issues;
  }
}

/**
 * Walk `rawDir` (e.g. `benchmarks/real-corpus/raw/`) and return every
 * `UnlabeledPrCorpusEntry` found. Entries are sorted by id for
 * deterministic downstream scoring. Duplicates on `{repository, prNumber}`
 * are surfaced as structural issues — the collector should be idempotent
 * but the loader does not trust that invariant blindly.
 */
export async function loadPrCorpus(rawDir: string): Promise<UnlabeledPrCorpusEntry[]> {
  const root = path.resolve(rawDir);
  if (!(await pathExists(root))) {
    return [];
  }
  const issues: PrCorpusStructureIssue[] = [];
  const entries: UnlabeledPrCorpusEntry[] = [];
  const files = await collectEntryFiles(root);
  for (const file of files) {
    const loaded = await readEntryFile(file);
    if ('issue' in loaded) {
      issues.push(loaded.issue);
      continue;
    }
    entries.push(loaded.entry);
  }
  for (const dup of findDuplicateKeys(entries)) {
    issues.push({
      path: root,
      reason: `duplicate entry for ${dup} across multiple vendor directories`,
      remediation: 'Delete the older raw file; collector should not produce duplicates.',
    });
  }
  if (issues.length > 0) {
    throw new PrCorpusLoaderError(issues);
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Pair every unlabeled entry with its label (if any). Entries whose
 * label file is missing or invalid are dropped from the labeled list
 * but reported back in `unlabeledIds` / `invalidIds` so callers can
 * print progress without re-walking the labels directory.
 */
export async function loadLabeledPrEntries(
  entries: readonly UnlabeledPrCorpusEntry[],
  labelsDir: string,
): Promise<{
  labeled: PrCorpusEntry[];
  unlabeledIds: string[];
  invalidIds: { id: string; issues: string[] }[];
}> {
  const labeled: PrCorpusEntry[] = [];
  const unlabeledIds: string[] = [];
  const invalidIds: { id: string; issues: string[] }[] = [];
  for (const entry of entries) {
    const label = await readLabel(labelsDir, entry.id);
    if (label === undefined) {
      unlabeledIds.push(entry.id);
      continue;
    }
    if (label.issues.length > 0) {
      invalidIds.push({ id: entry.id, issues: label.issues });
      continue;
    }
    labeled.push(withGroundTruth(entry, label.label));
  }
  return { labeled, unlabeledIds, invalidIds };
}

function withGroundTruth(
  entry: UnlabeledPrCorpusEntry,
  groundTruth: GroundTruthLabel,
): PrCorpusEntry {
  return { ...entry, groundTruth };
}

async function collectEntryFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  await walkJson(root, out);
  return out;
}

async function walkJson(dir: string, out: string[]): Promise<void> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    throw new Error(`real-corpus loader: failed to read ${dir}: ${(err as Error).message}`, {
      cause: err,
    });
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkJson(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      out.push(full);
    }
  }
}

async function readEntryFile(
  file: string,
): Promise<{ entry: UnlabeledPrCorpusEntry } | { issue: PrCorpusStructureIssue }> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    return {
      issue: {
        path: file,
        reason: `failed to read file: ${(err as Error).message}`,
        remediation: 'Check filesystem permissions and re-run the loader.',
      },
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      issue: {
        path: file,
        reason: `invalid JSON: ${(err as Error).message}`,
        remediation: 'Re-run the collector to regenerate the file, or delete it.',
      },
    };
  }
  const validationErrors = validateUnlabeledPrEntry(parsed);
  if (validationErrors.length > 0) {
    return {
      issue: {
        path: file,
        reason: `does not match UnlabeledPrCorpusEntry shape: ${validationErrors.join('; ')}`,
        remediation: 'Re-run the collector to regenerate this entry.',
      },
    };
  }
  if (!isUnlabeledPrEntry(parsed)) {
    return {
      issue: {
        path: file,
        reason: 'failed structural type guard despite passing validator',
        remediation: 'Report this as a loader bug; validator and guard are out of sync.',
      },
    };
  }
  return { entry: parsed };
}

function findDuplicateKeys(entries: readonly UnlabeledPrCorpusEntry[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const e of entries) {
    const key = `${e.pr.repository}#${e.pr.number}`;
    if (seen.has(key)) dups.add(key);
    seen.add(key);
  }
  return [...dups].sort();
}

function formatIssueMessage(issues: readonly PrCorpusStructureIssue[]): string {
  const lines = issues.map((i) => `  - ${i.path}: ${i.reason} (${i.remediation})`);
  return `real-corpus loader: ${issues.length} issue(s)\n${lines.join('\n')}`;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
