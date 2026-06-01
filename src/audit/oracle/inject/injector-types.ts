// Types for the defect-injection oracle. An injector is a pure diff
// transform: it takes a presumed-clean PR diff and returns a plan that
// splices one constructively-labeled defect into it. The runner renders
// the plan to a broken-variant diff and stamps a label, so injectors stay
// small and never touch the filesystem.
//
// The category string is wider than the detector `CheatCategory` union on
// purpose: it also carries the two semantic categories (goal-not-fixed,
// cheat-mock-mutation) that no structural detector keys on, which is the
// whole point of the oracle.

import type { File as ParsedDiffFile } from 'parse-diff';

export type OracleCategory =
  | 'test-relaxation'
  | 'mock-of-hallucination'
  | 'assertion-strip'
  | 'no-op-fix'
  | 'coverage-erosion'
  | 'fake-refactor'
  | 'comment-only-fix'
  | 'error-swallow'
  | 'exception-rethrow-lost-context'
  | 'dead-branch-insertion'
  | 'type-suppression'
  | 'goal-not-fixed'
  | 'cheat-mock-mutation';

export type LineKind = 'context' | 'add' | 'del';

export interface DiffLine {
  kind: LineKind;
  text: string;
}

export function ctx(text: string): DiffLine {
  return { kind: 'context', text };
}
export function add(text: string): DiffLine {
  return { kind: 'add', text };
}
export function del(text: string): DiffLine {
  return { kind: 'del', text };
}

export interface InjectionInput {
  /** Stable id of the source PR (used in output paths). */
  prId: string;
  sourcePrUrl: string;
  /** PR title, carried so the semantic injectors can stamp a fix claim
   *  the injected code contradicts, and so the judge can read it. */
  prTitle: string;
  cleanDiff: string;
  files: ParsedDiffFile[];
  /** Deterministic per-(pr,injector) seed for carrier selection. */
  seed: number;
}

export interface InjectionPlan {
  /** Carrier path: an existing file from the PR, or a new path derived
   *  from a real PR directory when `isNewFile` is true. */
  file: string;
  isNewFile: boolean;
  /** Hunk body to splice in. */
  lines: DiffLine[];
  /**
   * Emit the defect as a standalone single-file diff rather than appending
   * it to the carrier PR. Whole-PR-scoped detectors (comment-only-fix,
   * coverage-erosion) only fire when the entire diff is the defect, so
   * appending into a carrier that already has real changes masks them.
   * Isolated mode still uses the carrier's real file path.
   */
  isolated?: boolean;
  /**
   * A second file rendered into the same isolated diff. Used by the
   * no-op-fix injector, whose detector signal needs both a source and a
   * test change in one diff that share no identifier.
   */
  secondFile?: { file: string; lines: DiffLine[] };
  /** A claim, carried into the label, that the injected code does not
   *  satisfy. Only set by the semantic injectors. */
  claim?: string;
}

export interface InjectionLabel {
  category: OracleCategory;
  injectorId: string;
  file: string;
  hunkIndex: number;
  startLine: number;
  endLine: number;
  sourcePrUrl: string;
  prTitle: string;
  /** Present for semantic categories: the claim the code contradicts. */
  claim?: string;
  /** sha256 over the broken-variant diff, stamped by the runner. */
  sha256: string;
}

export interface Injector {
  id: string;
  category: OracleCategory;
  description: string;
  /** Return a plan, or null to refuse this PR (no suitable carrier, or
   *  the site already exhibits the defect shape). */
  plan(input: InjectionInput): InjectionPlan | null;
}
