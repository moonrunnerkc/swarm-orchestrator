// Deterministic mock-delta pre-filter for the cheat-mock-mutation semantic
// category. A mutated mock is invisible to every structural detector: the
// assertion still exists, nothing is stripped, and the mocked target is a
// real local unit, so `mockResolvedValue(fakeData)` reads as ordinary test
// setup. Only the judge can call it, but the judge measured 0.16 recall
// running over the whole PR diff: the six-line mock hunk is a needle in a
// 40k-char haystack, and a single yes/no over the whole diff walks past it.
//
// This module finds the hunks that introduce a value-injecting mock in a
// test file and hands ONLY those hunks to the judge. Two effects, both
// measured in benchmarks/results/AB-REPORT.md:
//   - recall up: the judge reads the mock hunk in isolation, so the
//     value-injection is the whole prompt, not a tail detail it skims.
//   - false positives down: the judge is asked the cheat-mock-mutation
//     question only when an added mock-return wiring actually exists, so a
//     clean PR with no such hunk never produces a false yes for this
//     category (the whole-diff path asked on every PR).
//
// The filter is high-recall on purpose: any added value-injecting mock in a
// test hunk qualifies, and the judge makes the legitimate-vs-cheat call on
// the focused hunk. That division (deterministic locate, judge confirm) is
// the same shape as the structural detectors feeding the confirmation gate.

import { chunkUnifiedDiffByHunk } from './diff-chunker';
import { isTestFile } from './diff-walker';
import type { SemanticCheatCategory } from '../types';

// jest / vitest value-injecting mock methods: each exists only to make a
// mock hand back a fixed value or a scripted implementation, which is the
// exact lever a mock-mutation cheat pulls. `mockImplementation` is included
// because `mockImplementation(() => expected)` injects a value just as
// `mockReturnValue(expected)` does.
const JEST_MOCK_RETURN_RE =
  /\.(?:mockReturnValue|mockResolvedValue|mockRejectedValue|mockReturnValueOnce|mockResolvedValueOnce|mockRejectedValueOnce|mockImplementation|mockImplementationOnce)\s*\(/;

// sinon stubs inject a value through `.returns(...)` / `.resolves(...)`.
// Those method names are common enough on their own (a promise helper can
// expose `.resolves`) that we only treat them as a mock signal when the
// hunk is plainly sinon: it names `sinon` or constructs a `stub`.
const SINON_RETURN_RE = /\.(?:returns|resolves|rejects)\s*\(/;
const SINON_CONTEXT_RE = /\b(?:sinon|\.stub\s*\(|createStubInstance)\b|\bstub\b/;

/** An added (`+`) content line, excluding the unified-diff `+++` file header. */
function isAddedContentLine(line: string): boolean {
  return line.startsWith('+') && !line.startsWith('+++');
}

/** True when a single added line introduces a value-injecting mock. */
function addedLineInjectsMock(line: string, hunkText: string): boolean {
  if (!isAddedContentLine(line)) return false;
  if (JEST_MOCK_RETURN_RE.test(line)) return true;
  if (SINON_RETURN_RE.test(line) && SINON_CONTEXT_RE.test(hunkText)) return true;
  return false;
}

/** True when a one-hunk diff (file header + hunk) adds a value-injecting mock. */
function hunkInjectsMock(hunkText: string): boolean {
  for (const line of hunkText.split('\n')) {
    if (addedLineInjectsMock(line, hunkText)) return true;
  }
  return false;
}

/**
 * Extract the test-file hunks that introduce a value-injecting mock, each as
 * a valid one-hunk unified diff (file header + hunk). Returns the hunks in
 * diff order and a `focusedDiff` that concatenates them, or `null` when the
 * diff introduces no such mock.
 *
 * Pure and deterministic: the same diff always yields the same focused diff,
 * so a committed benchmark replays the exact prompt the judge was scored
 * against (the focused diff folds into the judge cache key).
 */
export function extractMockMutationFocus(diff: string): {
  hunks: string[];
  focusedDiff: string | null;
} {
  const hits: string[] = [];
  for (const chunk of chunkUnifiedDiffByHunk(diff)) {
    if (!isTestFile(chunk.file)) continue;
    if (hunkInjectsMock(chunk.text)) hits.push(chunk.text);
  }
  return { hunks: hits, focusedDiff: hits.length > 0 ? hits.join('') : null };
}

/**
 * The diff a semantic-category judge call should read, plus whether to skip
 * the call entirely. Single source of truth shared by the production
 * judge-primary path and the oracle / calibration harnesses so the scored
 * prompt and the shipped prompt are identical.
 *
 * - `goal-not-fixed`: the whole diff, never skipped (the claimed fix can be
 *   anywhere in the change).
 * - `cheat-mock-mutation`: only the mock-bearing hunks; skip when the diff
 *   introduces no value-injecting mock (no signal, so no finding).
 */
export function focusSemanticDiff(
  category: SemanticCheatCategory,
  diff: string,
): { skip: boolean; diff: string } {
  if (category !== 'cheat-mock-mutation') return { skip: false, diff };
  const { focusedDiff } = extractMockMutationFocus(diff);
  if (focusedDiff === null) return { skip: true, diff };
  return { skip: false, diff: focusedDiff };
}
