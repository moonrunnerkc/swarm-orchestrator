// Diff-surgery primitives shared by every injector. Two operations:
// append an all-added new file, or append one hunk to an existing file's
// section of the PR diff. Both are append-only: they never rewrite an
// existing hunk, so the carrier PR's real content is preserved byte-for-
// byte and the only fragile part (recomputing @@ offsets of following
// hunks) never arises.
//
// Carrier files are chosen by kind (test vs source) from the PR's own
// touched files, which is the "site selection by hunk analysis" the
// injectors rely on instead of string slop.

import type { File as ParsedDiffFile } from 'parse-diff';
import { isTestFile, filePath, fileKind } from '../../cheat-detector/diff-walker';
import type { DiffLine, InjectionInput, InjectionPlan } from './injector-types';

export function isTestPath(p: string): boolean {
  return isTestFile(p);
}

export function isSourcePath(p: string): boolean {
  if (isTestFile(p)) return false;
  return /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|java)$/.test(p);
}

/** Deterministically pick one carrier path from the PR's files matching
 *  `predicate`. Sorted by path first so the choice is stable regardless
 *  of parse order; the seed rotates the selection across injectors. */
export function pickCarrier(
  files: ParsedDiffFile[],
  predicate: (path: string) => boolean,
  seed: number,
): string | undefined {
  const candidates = files
    .filter((f) => fileKind(f) === 'modify' || fileKind(f) === 'add')
    .map((f) => filePath(f))
    .filter((p) => p !== '<unknown>' && predicate(p))
    .sort();
  if (candidates.length === 0) return undefined;
  return candidates[seed % candidates.length];
}

/** Directory of a real PR file, for placing a realistic new-file path. */
export function pickDirectory(
  files: ParsedDiffFile[],
  predicate: (path: string) => boolean,
  seed: number,
): string | undefined {
  const carrier = pickCarrier(files, predicate, seed);
  if (carrier === undefined) return undefined;
  const slash = carrier.lastIndexOf('/');
  return slash === -1 ? '' : carrier.slice(0, slash);
}

function renderBody(lines: DiffLine[]): string {
  return lines
    .map((l) => {
      if (l.kind === 'add') return `+${l.text}`;
      if (l.kind === 'del') return `-${l.text}`;
      return ` ${l.text}`;
    })
    .join('\n');
}

function ensureTrailingNewline(diff: string): string {
  return diff.endsWith('\n') ? diff : `${diff}\n`;
}

export interface RenderedInjection {
  brokenDiff: string;
  hunkIndex: number;
  startLine: number;
  endLine: number;
}

/** Render an all-added new file appended to the diff. */
function renderNewFile(cleanDiff: string, plan: InjectionPlan): RenderedInjection {
  if (plan.lines.some((l) => l.kind !== 'add')) {
    throw new Error(`new-file injection for ${plan.file} may only contain added lines`);
  }
  const newCount = plan.lines.length;
  const block =
    `diff --git a/${plan.file} b/${plan.file}\n` +
    'new file mode 100644\n' +
    'index 0000000..1111111\n' +
    `--- /dev/null\n` +
    `+++ b/${plan.file}\n` +
    `@@ -0,0 +1,${newCount} @@\n` +
    `${renderBody(plan.lines)}\n`;
  return {
    brokenDiff: ensureTrailingNewline(cleanDiff) + block,
    hunkIndex: 0,
    startLine: 1,
    endLine: newCount,
  };
}

/** Append one hunk to the carrier file's existing diff section. Operates
 *  on a line array so the per-file newlines are preserved exactly: the
 *  new hunk is spliced in just before the next file's `diff --git` line
 *  (or at end of file), and every original line is kept verbatim. */
function renderAppendHunk(
  cleanDiff: string,
  plan: InjectionPlan,
  seed: number,
): RenderedInjection | null {
  const normalized = ensureTrailingNewline(cleanDiff);
  const lines = normalized.split('\n');
  // The trailing '\n' yields a final '' element; keep it so the rebuilt
  // diff also ends in a newline.
  const fileStarts: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if ((lines[i] ?? '').startsWith('diff --git ')) fileStarts.push(i);
  }
  const targetStart = fileStarts.find((i) => linePath(lines[i] ?? '') === plan.file);
  if (targetStart === undefined) return null;
  const next = fileStarts.find((i) => i > targetStart);
  // Section runs to the next file start, or to the last real line (the
  // element before the trailing '').
  const sectionEnd = next ?? lines.length - 1;

  const oldCount = plan.lines.filter((l) => l.kind !== 'add').length;
  const newCount = plan.lines.filter((l) => l.kind !== 'del').length;
  const startNew = 100000 + (seed % 4000) * 10;
  const hunkLines = [`@@ -${startNew},${oldCount} +${startNew},${newCount} @@`, ...renderBodyLines(plan.lines)];
  const hunkIndex = lines
    .slice(targetStart, sectionEnd)
    .filter((l) => l.startsWith('@@ ')).length;

  lines.splice(sectionEnd, 0, ...hunkLines);
  return {
    brokenDiff: lines.join('\n'),
    hunkIndex,
    startLine: startNew,
    endLine: startNew + Math.max(0, newCount - 1),
  };
}

function renderBodyLines(lines: DiffLine[]): string[] {
  return lines.map((l) => {
    if (l.kind === 'add') return `+${l.text}`;
    if (l.kind === 'del') return `-${l.text}`;
    return ` ${l.text}`;
  });
}

function linePath(line: string): string | undefined {
  const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
  return m?.[2];
}

function renderFileBlock(file: string, lines: DiffLine[]): string {
  const oldCount = lines.filter((l) => l.kind !== 'add').length;
  const newCount = lines.filter((l) => l.kind !== 'del').length;
  return (
    `diff --git a/${file} b/${file}\n` +
    'index 1111111..2222222 100644\n' +
    `--- a/${file}\n` +
    `+++ b/${file}\n` +
    `@@ -1,${oldCount} +1,${newCount} @@\n` +
    `${renderBody(lines)}\n`
  );
}

/** A standalone modify diff carrying only the defect (optionally across
 *  two files), used by whole-PR-scoped detectors that an appended hunk
 *  cannot trigger. */
function renderStandaloneHunk(plan: InjectionPlan): RenderedInjection {
  let block = renderFileBlock(plan.file, plan.lines);
  if (plan.secondFile !== undefined) {
    block += renderFileBlock(plan.secondFile.file, plan.secondFile.lines);
  }
  const newCount = plan.lines.filter((l) => l.kind !== 'del').length;
  return { brokenDiff: block, hunkIndex: 0, startLine: 1, endLine: newCount };
}

export function renderPlan(input: InjectionInput, plan: InjectionPlan): RenderedInjection | null {
  if (plan.isolated === true && !plan.isNewFile) return renderStandaloneHunk(plan);
  if (plan.isNewFile) return renderNewFile(plan.isolated === true ? '' : input.cleanDiff, plan);
  return renderAppendHunk(input.cleanDiff, plan, input.seed);
}

/** True when the clean diff already shows the defect signature, so an
 *  injector should refuse rather than stack a second instance and muddy
 *  the label. */
export function alreadyContains(cleanDiff: string, signature: RegExp): boolean {
  return signature.test(cleanDiff);
}
