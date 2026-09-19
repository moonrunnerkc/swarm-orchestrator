import { digestOfJson } from "../evidence/canonical-json.ts";
import {
  carriesCode,
  namesATestFile,
  namesATypeTest,
  pathSetAside,
} from "../gates/oracle-reach.ts";
import { parseUnifiedDiff } from "../gates/unified-diff.ts";
import type { PatchFile } from "./repair-progress.ts";

/**
 * The size of a patch, in the terms the reach check itself reads a patch in.
 *
 * "Executable" is reach's own definition and nothing new: a line in a file a runner could load,
 * outside a test file, carrying a character that could begin an identifier, a number or a string.
 * Counting by a second rule would let a repair look smaller or larger than the check that
 * prompted it saw it. No branch or condition count is offered, because nothing in this repository
 * parses the languages of the mined projects and a pattern over text would be a guess.
 */
export interface PatchMetrics {
  readonly filesChanged: number;
  readonly sourceFilesChanged: number;
  readonly testFilesChanged: number;
  readonly addedLines: number;
  readonly deletedLines: number;
  readonly executableAddedLines: number;
  readonly executableDeletedLines: number;
  readonly testAddedLines: number;
  readonly diffBytes: number;
}

export function patchMetrics(patch: string): PatchMetrics {
  const files = parseUnifiedDiff(patch);
  let addedLines = 0;
  let deletedLines = 0;
  let executableAddedLines = 0;
  let executableDeletedLines = 0;
  let testAddedLines = 0;
  let sourceFilesChanged = 0;
  let testFilesChanged = 0;
  for (const file of files) {
    const test = namesATestFile(file.path) || namesATypeTest(file.path);
    const source = pathSetAside(file.path) === null;
    if (test) testFilesChanged += 1;
    if (source) sourceFilesChanged += 1;
    addedLines += file.addedLines.length;
    deletedLines += file.removedLines.length;
    if (test) testAddedLines += file.addedLines.length;
    if (source) {
      executableAddedLines += file.addedLines.filter((one) => carriesCode(one.text)).length;
      executableDeletedLines += file.removedLines.filter(carriesCode).length;
    }
  }
  return {
    filesChanged: files.length,
    sourceFilesChanged,
    testFilesChanged,
    addedLines,
    deletedLines,
    executableAddedLines,
    executableDeletedLines,
    testAddedLines,
    diffBytes: Buffer.byteLength(patch, "utf8"),
  };
}

/** Second minus first, field by field, so a repair's direction is a sign and not a reading. */
export function metricsDelta(first: PatchMetrics, second: PatchMetrics): PatchMetrics {
  const delta = {} as Record<keyof PatchMetrics, number>;
  for (const key of Object.keys(first) as (keyof PatchMetrics)[]) {
    delta[key] = second[key] - first[key];
  }
  return delta;
}

/**
 * The files of a patch, each with a digest of its own changes, so two patches compare by file.
 *
 * Digested from the parsed change and not from the section's bytes: git's index line carries blob
 * abbreviations whose length depends on the repository, and a file that did not change between
 * two patches has to read as one that did not.
 */
export function patchFiles(patch: string): PatchFile[] {
  return parseUnifiedDiff(patch)
    .map((file) => ({
      path: file.path,
      change: file.kind,
      diffDigest: digestOfJson({
        kind: file.kind,
        added: file.addedLines.map((one) => [one.line, one.text]),
        removed: [...file.removedLines],
      }),
    }))
    .sort((left, right) => (left.path < right.path ? -1 : 1));
}

/** The trimmed text of one added line, which is what a finding about it is named by. */
export function addedLineText(patch: string, path: string, line: number): string | null {
  const file = parseUnifiedDiff(patch).find((one) => one.path === path);
  return file?.addedLines.find((one) => one.line === line)?.text.trim() ?? null;
}
