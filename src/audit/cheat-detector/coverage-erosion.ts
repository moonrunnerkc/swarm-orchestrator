// Coverage erosion: a PR adds a new branch in a source file
// (`if`/`else`/`switch`/`case`) without a matching test addition.
// We approximate without a coverage tool by counting branch-opening
// statements added in source vs. test files; a source-side delta of
// >= 1 with zero test-side assertion-or-test-block additions is flagged.

import type { Detector, DetectorContext } from './detector-types';
import type { Finding } from '../types';
import { isPlausiblyTestReachable, isTestFile, walkHunks } from './diff-walker';

const VERSION = '1.1.0';

const BRANCH_PATTERNS: RegExp[] = [
  /\bif\s*\(/,
  /\belse\s+if\s*\(/,
  /\bswitch\s*\(/,
  /\bcase\s+[^:]+:/,
];

// A "real" test addition: a line that contains an assertion or a
// test-block opener (jest/mocha/vitest/chai, plus pytest/junit/go-test).
// Counting raw added lines lets a single comment or blank line in any
// test file suppress the entire coverage-erosion finding, which makes
// the detector trivially defeatable: add a `// noqa` to any test file
// and the new source branch goes unflagged.
const TEST_SIGNAL_PATTERNS: RegExp[] = [
  /\bexpect\s*\(/,
  /\bassert(?:Equal|True|False|Throws|Raises|That)?\b/,
  /\b(?:it|test|describe|context|specify)\s*\(/,
  /\bshould\b/,
  /\b@Test\b/,
  /^\s*def\s+test_/,
  /^\s*func\s+Test/,
];

export const coverageErosionDetector: Detector = {
  name: 'coverage-erosion',
  version: VERSION,
  run(ctx: DetectorContext): Finding[] {
    let sourceBranches = 0;
    let testAdds = 0;
    const sourceLocations: Array<{ file: string; line: number; content: string }> = [];
    for (const hunk of walkHunks(ctx.files)) {
      const test = isTestFile(hunk.file);
      // For source-side branch counting, only count file classes that
      // could plausibly be reached by a test. A docs file with a code
      // block that happens to contain `if (` is not test-reachable
      // source; flagging it as coverage erosion is noise.
      if (!test && !isPlausiblyTestReachable(hunk.file)) continue;
      for (const a of hunk.added) {
        if (test) {
          if (TEST_SIGNAL_PATTERNS.some((re) => re.test(a.content))) {
            testAdds += 1;
          }
        } else if (BRANCH_PATTERNS.some((re) => re.test(a.content))) {
          sourceBranches += 1;
          sourceLocations.push({ file: hunk.file, line: a.lineNumber, content: a.content });
        }
      }
    }
    if (sourceBranches === 0) return [];
    if (testAdds > 0) return [];
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
