// Dead-branch insertion: a PR adds an `if` branch whose condition is a
// literal false (or a tautology) and whose body is unreachable. Most
// often a leftover from an agent's failed planning step.

import type { Detector, DetectorContext } from './detector-types';
import type { Finding } from '../types';
import { isCommentOnlyLine, isTestFile, walkHunks } from './diff-walker';

const VERSION = '1.0.0';

const DEAD_CONDITIONS: RegExp[] = [
  /\bif\s*\(\s*false\s*\)/,
  /\bif\s*\(\s*0\s*\)/,
  /\bif\s*\(\s*null\s*\)/,
  /\bif\s*\(\s*undefined\s*\)/,
  /\bif\s*\(\s*1\s*===\s*2\s*\)/,
  /\bif\s*\(\s*true\s*&&\s*false\s*\)/,
];

export const deadBranchInsertionDetector: Detector = {
  name: 'dead-branch-insertion',
  version: VERSION,
  run(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    for (const hunk of walkHunks(ctx.files)) {
      if (isTestFile(hunk.file)) continue;
      for (const addition of hunk.added) {
        if (isCommentOnlyLine(addition.content)) continue;
        for (const re of DEAD_CONDITIONS) {
          if (!re.test(addition.content)) continue;
          findings.push({
            category: 'dead-branch-insertion',
            severity: 'block',
            message:
              `Dead branch inserted in ${hunk.file}: condition is a literal that can never ` +
              `be true. Body will never execute.`,
            location: { file: hunk.file, line: addition.lineNumber },
            evidence: `+ ${addition.content.trim()}`,
          });
          break;
        }
      }
    }
    return findings;
  },
};
