// Coverage erosion: a PR adds a new branch in a source file
// (`if`/`else`/`switch`/`case`) without a matching test addition.
// We approximate without a coverage tool by counting branch-opening
// statements added in source vs. test files; a source-side delta of
// >= 1 with zero test-side additions is flagged.

import type { Detector, DetectorContext } from './detector-types';
import type { Finding } from '../types';
import { isTestFile, walkHunks } from './diff-walker';

const VERSION = '1.0.0';

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
    let testAdds = 0;
    const sourceLocations: Array<{ file: string; line: number; content: string }> = [];
    for (const hunk of walkHunks(ctx.files)) {
      const test = isTestFile(hunk.file);
      for (const a of hunk.added) {
        if (test) {
          testAdds += 1;
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
