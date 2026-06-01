// Coverage erosion: a PR adds a new branch in a source file
// (`if`/`else`/`switch`/`case`) while leaving the test suite untouched.
// We approximate without a coverage tool: a source-side branch addition
// with no edit to any test file in the whole PR is flagged.
//
// The gate is "the PR touched no test file at all", not "the PR added no
// recognized assertion line". A real-PR pilot showed the narrower gate
// fired on ordinary refactors that add a conditional and update their
// tests with setup lines that are not assertion-shaped (a new fixture,
// a `.bind()` call). Those PRs engaged their tests; flagging them as
// coverage erosion is noise. Requiring zero test-file edits keeps the
// signal on the real erosion shape (source changed, tests ignored) while
// dropping the common legitimate case.

import type { Detector, DetectorContext } from './detector-types';
import type { Finding } from '../types';
import { isPlausiblyTestReachable, isTestFile, walkHunks } from './diff-walker';

const VERSION = '1.2.0';

const BRANCH_PATTERNS: RegExp[] = [
  /\bif\s*\(/,
  /\belse\s+if\s*\(/,
  /\bswitch\s*\(/,
  /\bcase\s+[^:]+:/,
];

export const coverageErosionDetector: Detector = {
  name: 'coverage-erosion',
  version: VERSION,
  run(ctx: DetectorContext): Finding[] {
    let sourceBranches = 0;
    let testFileTouched = false;
    const sourceLocations: Array<{ file: string; line: number; content: string }> = [];
    for (const hunk of walkHunks(ctx.files)) {
      const test = isTestFile(hunk.file);
      if (test) {
        // Any edit to a test file (added or removed lines) means the PR
        // engaged its tests; do not treat it as coverage erosion.
        if (hunk.added.length > 0 || hunk.deleted.length > 0) testFileTouched = true;
        continue;
      }
      // For source-side branch counting, only count file classes that
      // could plausibly be reached by a test. A docs file with a code
      // block that happens to contain `if (` is not test-reachable
      // source; flagging it as coverage erosion is noise.
      if (!isPlausiblyTestReachable(hunk.file)) continue;
      for (const a of hunk.added) {
        if (BRANCH_PATTERNS.some((re) => re.test(a.content))) {
          sourceBranches += 1;
          sourceLocations.push({ file: hunk.file, line: a.lineNumber, content: a.content });
        }
      }
    }
    if (sourceBranches === 0) return [];
    if (testFileTouched) return [];
    return sourceLocations.map((loc) => ({
      category: 'coverage-erosion',
      severity: 'warn',
      message:
        `Source branch added in ${loc.file} with no compensating test addition in this PR. ` +
        `Likely coverage erosion.`,
      location: { file: loc.file, line: loc.line },
      evidence: `+ ${loc.content.trim()}`,
    }));
  },
};
