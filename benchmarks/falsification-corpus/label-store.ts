import * as fs from 'fs/promises';
import * as path from 'path';
import { validateGroundTruthLabel } from './label-rules';
import type { CorpusEntry, GroundTruthLabel, UnlabeledCorpusEntry } from './schema';

export interface LabelWriteOptions {
  replace?: boolean;
}

export interface LabelStatusRow {
  entryId: string;
  labelPath: string;
  status: 'labeled' | 'unlabeled' | 'invalid';
  verdict?: GroundTruthLabel['verdict'];
  issues: string[];
}

/** Returns the absolute label-file path for one corpus entry. */
export function labelPathFor(labelsDir: string, entryId: string): string {
  return path.join(path.resolve(labelsDir), `${entryId}.label.json`);
}

/** Reads and validates a label file, returning undefined when it does not exist. */
export async function readLabel(
  labelsDir: string,
  entryId: string,
): Promise<{ label: GroundTruthLabel; issues: string[] } | undefined> {
  const labelPath = labelPathFor(labelsDir, entryId);
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(labelPath, 'utf8'));
    if (!isGroundTruthLabelShape(parsed)) {
      return { label: emptyInvalidLabel(), issues: ['label file does not match GroundTruthLabel shape'] };
    }
    return { label: parsed, issues: validateGroundTruthLabel(parsed) };
  } catch (error: unknown) {
    if (isNotFound(error)) return undefined;
    return { label: emptyInvalidLabel(), issues: [`label file could not be read: ${reasonOf(error)}`] };
  }
}

/** Writes one validated label file and refuses accidental overwrites by default. */
export async function writeLabel(
  labelsDir: string,
  entryId: string,
  label: GroundTruthLabel,
  options: LabelWriteOptions = {},
): Promise<string> {
  const issues = validateGroundTruthLabel(label);
  if (issues.length > 0) {
    throw new Error(`${entryId} [label]: invalid label: ${issues.join('; ')}`);
  }
  const labelPath = labelPathFor(labelsDir, entryId);
  await fs.mkdir(path.dirname(labelPath), { recursive: true });
  if (!options.replace && await exists(labelPath)) {
    throw new Error(`${entryId} [label]: ${labelPath} already exists. Re-run with --replace to overwrite.`);
  }
  await fs.writeFile(labelPath, `${JSON.stringify(label, null, 2)}\n`, 'utf8');
  return labelPath;
}

/** Combines unlabeled corpus entries with existing labels, skipping invalid labels. */
export async function loadLabeledEntries(
  entries: readonly UnlabeledCorpusEntry[],
  labelsDir: string,
): Promise<{ labeled: CorpusEntry[]; status: LabelStatusRow[] }> {
  const status = await buildLabelStatus(entries, labelsDir);
  const labeled: CorpusEntry[] = [];
  for (const entry of entries) {
    const label = await readLabel(labelsDir, entry.id);
    if (label !== undefined && label.issues.length === 0) {
      labeled.push({ ...entry, groundTruth: label.label });
    }
  }
  return { labeled, status };
}

/** Builds label-status rows for every corpus entry. */
export async function buildLabelStatus(
  entries: readonly UnlabeledCorpusEntry[],
  labelsDir: string,
): Promise<LabelStatusRow[]> {
  const rows: LabelStatusRow[] = [];
  for (const entry of entries) {
    const labelPath = labelPathFor(labelsDir, entry.id);
    const label = await readLabel(labelsDir, entry.id);
    if (label === undefined) {
      rows.push({ entryId: entry.id, labelPath, status: 'unlabeled', issues: [] });
      continue;
    }
    rows.push({
      entryId: entry.id,
      labelPath,
      status: label.issues.length === 0 ? 'labeled' : 'invalid',
      verdict: label.label.verdict,
      issues: label.issues,
    });
  }
  return rows;
}

/** Summarizes label status rows by status and verdict. */
export function summarizeLabelStatus(rows: readonly LabelStatusRow[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const row of rows) {
    summary[row.status] = (summary[row.status] ?? 0) + 1;
    if (row.verdict !== undefined && row.status === 'labeled') {
      summary[`verdict:${row.verdict}`] = (summary[`verdict:${row.verdict}`] ?? 0) + 1;
    }
  }
  return summary;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isGroundTruthLabelShape(value: unknown): value is GroundTruthLabel {
  if (!isRecord(value)) return false;
  const categories = value.brokenCategories;
  return typeof value.verdict === 'string'
    && typeof value.rationale === 'string'
    && typeof value.labeledBy === 'string'
    && typeof value.labeledAt === 'string'
    && (value.reviewedBy === undefined || typeof value.reviewedBy === 'string')
    && (categories === undefined || (Array.isArray(categories) && categories.every(item => typeof item === 'string')));
}

function emptyInvalidLabel(): GroundTruthLabel {
  return {
    verdict: 'ambiguous',
    rationale: '',
    labeledBy: '',
    labeledAt: '',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
