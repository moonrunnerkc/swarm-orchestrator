// Matching a structural finding to a set of changed-line ranges by file and
// line. The single implementation behind two callers:
//
//   1. The offline benchmark harness (scripts/real-prs/correlate-execution-
//      grounded.ts) matches structural findings against a regression PR's
//      proof (the revert/fix diff) to score the headline numbers.
//
//   2. The live audit path (cli/v8/audit-handler.ts, opt-in via
//      executionGrounded.corroborateStructural) matches each structural finding
//      against the same PR's own execution signals -- a surviving mutant, a
//      coverage gap, or a still-failing issue repro -- and annotates the ones
//      with runtime backing. A finding with no backing is left untouched and
//      stays advisory.
//
// Both reduce to the same question: does this finding's location fall inside
// these per-file line ranges (optionally widened to absorb cross-commit drift)?
// The point of the live path is precision: a structural pattern that also
// leaves a surviving mutant on the same line is far more likely a real cheat
// than a legitimate refactor, so it can be emitted at higher confidence.

import type { CheatCategory, Finding, RuntimeCorroboration } from '../types';
import { lineInRanges, type ChangedLineRanges } from '../cheat-detector/diff-walker';
import { setFindingConfidence } from '../cheat-detector/verify-findings';
import type { ExecutionGroundedOutcome } from './index';

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

/** The cheat categories each kind of execution signal can corroborate. A
 *  surviving mutant means the suite ran a line without constraining it; a
 *  coverage gap means no test ran it; a still-failing repro means the claimed
 *  fix did not land. Categories not listed are never auto-corroborated. */
const MUTANT_CORROBORATES: ReadonlySet<CheatCategory> = new Set<CheatCategory>([
  'coverage-erosion',
  'test-relaxation',
  'assertion-strip',
  'fake-refactor',
]);
const COVERAGE_GAP_CORROBORATES: ReadonlySet<CheatCategory> = new Set<CheatCategory>([
  'coverage-erosion',
  'assertion-strip',
]);
const REPRO_CORROBORATES: ReadonlySet<CheatCategory> = new Set<CheatCategory>(['goal-not-fixed']);

export interface SurvivingMutant {
  file: string;
  line: number;
  /** A stable id for the mutant, e.g. `BlockStatement@src/x.ts:12 -> Survived`. */
  id: string;
}
export interface CoverageGap {
  file: string;
  line: number;
}
export interface ReproFailure {
  /** Issue reference, e.g. `owner/repo#123`. */
  issueRef: string;
}

/** The execution-grounded signals a structural finding can be corroborated
 *  against, derived once from an execution-grounded run. */
export interface ExecutionSignals {
  survivingMutants: SurvivingMutant[];
  coverageGaps: CoverageGap[];
  reproFailures: ReproFailure[];
}

/** True when `line` is inside the finding's own changed-line range
 *  ([location.line, location.endLine ?? location.line]). */
function lineWithinFinding(finding: Finding, line: number): boolean {
  const start = finding.location.line;
  const end = finding.location.endLine ?? start;
  return line >= start && line <= end;
}

/**
 * Compute the runtime corroboration for one structural finding, or null when no
 * execution signal backs it. Mutant and coverage signals must land on the same
 * file within the finding's changed-line range; a still-failing repro is
 * PR-wide and corroborates a `goal-not-fixed` finding regardless of file.
 * Strongest-first: a surviving mutant (the suite ran the line but did not
 * constrain it) outranks a coverage gap (no test ran it). Pure.
 */
export function corroborationFor(finding: Finding, signals: ExecutionSignals): RuntimeCorroboration | null {
  if (MUTANT_CORROBORATES.has(finding.category)) {
    const hits = signals.survivingMutants.filter(
      (m) => m.file === finding.location.file && lineWithinFinding(finding, m.line),
    );
    if (hits.length > 0) return { signal: 'surviving-mutant', mutants: hits.map((h) => h.id) };
  }
  if (COVERAGE_GAP_CORROBORATES.has(finding.category)) {
    const hits = signals.coverageGaps.filter(
      (c) => c.file === finding.location.file && lineWithinFinding(finding, c.line),
    );
    if (hits.length > 0) return { signal: 'coverage-gap', uncoveredLines: hits.map((h) => h.line) };
  }
  if (REPRO_CORROBORATES.has(finding.category) && signals.reproFailures.length > 0) {
    return { signal: 'repro-still-fails', repro: signals.reproFailures.map((r) => r.issueRef).join(', ') };
  }
  return null;
}

/**
 * Annotate each structural finding that an execution signal backs with its
 * `runtimeCorroboration`, in place, and raise its confidence through the shared
 * setter (so the judge gate and this step cannot disagree). Findings with no
 * runtime backing are left exactly as they were and stay advisory. Returns the
 * count corroborated.
 */
export function corroborateStructuralFindings(findings: Finding[], signals: ExecutionSignals): number {
  let corroborated = 0;
  for (const finding of findings) {
    // A finding that already carries runtime backing (a proven test
    // restoration ran earlier in the same pass) keeps it: a restored test
    // failing is stronger evidence than any signal matched here.
    if (finding.runtimeCorroboration !== undefined) continue;
    const corroboration = corroborationFor(finding, signals);
    if (corroboration !== null) {
      finding.runtimeCorroboration = corroboration;
      setFindingConfidence(finding);
      corroborated += 1;
    }
  }
  return corroborated;
}

/**
 * Derive the execution signals from an execution-grounded run: every surviving
 * or uncovered mutant, every uncovered changed line, and every issue whose
 * repro still fails after the PR. Mutant and coverage paths are rerooted to
 * repo-relative the same way the finding builders are, so they match the
 * structural findings' file paths.
 */
export function executionSignalsFromOutcome(outcome: ExecutionGroundedOutcome): ExecutionSignals {
  const survivingMutants: SurvivingMutant[] = [];
  for (const run of outcome.mutationRuns) {
    for (const m of run.outcome.results) {
      if (m.killed) continue;
      if (m.status !== 'Survived' && m.status !== 'NoCoverage') continue;
      const file = run.packageDir.length > 0 ? `${run.packageDir}/${m.file}` : m.file;
      survivingMutants.push({ file, line: m.line, id: `${m.mutator}@${file}:${m.line} -> ${m.status}` });
    }
  }
  const coverageGaps: CoverageGap[] = [];
  for (const run of outcome.coverageRuns) {
    for (const d of run.outcome.deltas) {
      if (d.coveredAfter) continue;
      const file = run.packageDir.length > 0 ? `${run.packageDir}/${d.file}` : d.file;
      coverageGaps.push({ file, line: d.line });
    }
  }
  const reproFailures: ReproFailure[] = [];
  for (const c of outcome.repros) {
    if (c.verdict !== 'fix-not-delivered') continue;
    reproFailures.push({ issueRef: `${c.issue.owner}/${c.issue.repo}#${c.issue.number}` });
  }
  return { survivingMutants, coverageGaps, reproFailures };
}
