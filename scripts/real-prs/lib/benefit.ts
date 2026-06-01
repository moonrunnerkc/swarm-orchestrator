// Pure analysis helpers for the benefit report and the Venn analysis.
// Kept free of IO so they can be unit-tested: given a PR's auditor
// findings and the external tools' findings, decide what only the auditor
// caught, what only the external tools caught, and what both caught; and
// roll per-PR results up into corpus-level recall and false-positive
// numbers. "Caught by both" means an external finding landed on the same
// file within a few lines of the auditor finding; category names need not
// match, since the question is only whether any other tool flagged the
// same code.

import type { DifferentialFinding, DualArbiterLabel, HarnessFinding } from './types';

/** Slack, in lines, when matching an external finding to an auditor
 *  finding's range. Tools differ on whether they report the offending
 *  line or the enclosing statement's start. */
const LINE_SLACK = 3;

export function externalMatches(auditor: HarnessFinding, ext: DifferentialFinding): boolean {
  if (ext.file !== auditor.subjectPath) return false;
  const range = auditor.lineRange;
  if (range === null) return true;
  return ext.line >= range.start - LINE_SLACK && ext.line <= range.end + LINE_SLACK;
}

export interface VennSplit {
  onlyAuditorKeys: string[];
  onlyExternal: number;
  both: number;
}

/** Split one PR's auditor findings against the external findings. */
export function splitFindings(
  auditorFindings: HarnessFinding[],
  external: DifferentialFinding[],
): VennSplit {
  const matchedExternal = new Set<number>();
  const onlyAuditorKeys: string[] = [];
  let both = 0;
  for (const a of auditorFindings) {
    let matched = false;
    for (let i = 0; i < external.length; i += 1) {
      const ext = external[i];
      if (ext !== undefined && externalMatches(a, ext)) {
        matched = true;
        matchedExternal.add(i);
      }
    }
    if (matched) both += 1;
    else onlyAuditorKeys.push(a.key);
  }
  return { onlyAuditorKeys, onlyExternal: external.length - matchedExternal.size, both };
}

/** A PR is flagged when the pipeline raised at least one finding on it. */
export function isFlagged(findings: HarnessFinding[] | null): boolean {
  return findings !== null && findings.length > 0;
}

export interface RecallStat {
  flagged: number;
  total: number;
  rate: number;
}

export function recall(flagged: number, total: number): RecallStat {
  return { flagged, total, rate: total === 0 ? 0 : flagged / total };
}

/** Index dual-arbiter labels by their finding key for quick lookup. */
export function indexDualLabels(labels: DualArbiterLabel[]): Map<string, DualArbiterLabel> {
  const m = new Map<string, DualArbiterLabel>();
  for (const l of labels) m.set(l.key, l);
  return m;
}

/** A clean-corpus finding is a confirmed false alarm only when both
 *  arbiters agree it is one. Splits and single-arbiter labels are not
 *  counted in the headline. */
export function isConfirmedFalseAlarm(label: DualArbiterLabel | undefined): boolean {
  return label !== undefined && label.agreed && label.verdict === 'false-alarm';
}

export function isArbiterSplit(label: DualArbiterLabel | undefined): boolean {
  return label !== undefined && !label.agreed;
}
