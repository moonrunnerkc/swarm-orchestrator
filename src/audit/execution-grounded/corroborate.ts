// Matching a structural finding to a set of changed-line ranges by file and
// line. The single implementation behind two callers:
//
//   1. The offline benchmark harness (scripts/real-prs/correlate-execution-
//      grounded.ts) matches structural findings against a regression PR's
//      proof (the revert/fix diff) to score the headline numbers.
//
//   2. The live audit path (cli/v8/audit-handler.ts) matches each structural
//      finding against the same PR's own execution signals.
//
// Both reduce to the same question: does this finding's location fall inside
// these per-file line ranges (optionally widened to absorb cross-commit drift)?

import type { Finding } from '../types';
import { lineInRanges, type ChangedLineRanges } from '../cheat-detector/diff-walker';

/** Widen every range in `ranges` by `by` lines on each side (floored at line 1).
 *  Used by the offline harness to absorb cross-commit line drift between an
 *  audited PR and its later proof diff. */
export function expandRanges(ranges: ChangedLineRanges, by: number): ChangedLineRanges {
  const out: ChangedLineRanges = {};
  for (const [file, rs] of Object.entries(ranges)) {
    out[file] = rs.map((r) => ({ start: Math.max(1, r.start - by), end: r.end + by }));
  }
  return out;
}

/** True when a finding's location falls inside the given per-file ranges. The
 *  single matching primitive both callers key on. */
export function findingWithinRanges(finding: Finding, ranges: ChangedLineRanges): boolean {
  return lineInRanges(finding.location.line, ranges[finding.location.file]);
}
