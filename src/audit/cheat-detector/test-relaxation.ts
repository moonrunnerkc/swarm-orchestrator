// Test-relaxation: a PR is suspect when it edits an existing test in a
// way that weakens what the test was checking. Heuristics:
//   * deleted `expect(...).toBe(...)` not replaced with an equivalent
//   * exact-match converted to `expect.anything()` / `toBeDefined`
//   * removed `describe(`/`it(`/`test(` blocks
//   * removed Python `assert ...` lines without replacement
//   * removed Go `t.Fatal/`t.Error/Fail` calls
//   * `assertEqual` replaced with `assertTrue` of a tautology
//   * `assert.strictEqual` replaced with `assert.ok`
//
// We operate on parse-diff hunks: each pair (deleted line, added line)
// inside the same chunk is treated as a candidate replacement. Pure
// deletions count as relaxations on their own (the assertion vanished).
//
// Only test files (see diff-walker.isTestFile) are inspected.

import type { Detector, DetectorContext } from './detector-types';
import type { Finding } from '../types';
import { isTestFile, walkHunks } from './diff-walker';

const VERSION = '1.0.0';

const STRICT_MATCHERS: RegExp[] = [
  /\btoBe\s*\(/,
  /\btoEqual\s*\(/,
  /\btoStrictEqual\s*\(/,
  /\btoMatch\s*\(/,
  /\btoMatchObject\s*\(/,
  /\btoHaveBeenCalledWith\s*\(/,
  /\btoHaveBeenCalledTimes\s*\(/,
  /\bassertEqual\s*\(/,
  /\bassertStrictEqual\s*\(/,
  /\bassertDeepEqual\s*\(/,
  /\bassertDeepStrictEqual\s*\(/,
  /\bassert\.strictEqual\s*\(/,
  /\bassert\.deepStrictEqual\s*\(/,
  /\bassert\.deepEqual\s*\(/,
];

const LOOSE_MATCHERS: RegExp[] = [
  /\btoBeDefined\s*\(/,
  /\btoBeTruthy\s*\(/,
  /\btoBeFalsy\s*\(/,
  /\btoBeGreaterThanOrEqual\s*\(\s*0\s*\)/,
  /\btoBeGreaterThan\s*\(\s*-?\s*1\s*\)/,
  /\bexpect\.anything\s*\(/,
  /\bexpect\.any\s*\(/,
  /\bassertTrue\s*\(\s*True\s*\)/,
  /\bassert\.ok\s*\(\s*true\s*\)/,
];

const ASSERTION_LINE: RegExp[] = [
  /\bexpect\s*\(/,
  /\bassert\b/,
  /\bt\.Fatal\b/,
  /\bt\.Error\b/,
  /\bt\.Errorf\b/,
];

const TEST_BLOCK_OPENERS: RegExp[] = [
  /\bdescribe\s*\(/,
  /\bit\s*\(/,
  /\btest\s*\(/,
  /\bdef\s+test_/,
];

export const testRelaxationDetector: Detector = {
  name: 'test-relaxation',
  version: VERSION,
  run(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    const hunks = walkHunks(ctx.files);
    for (const hunk of hunks) {
      if (!isTestFile(hunk.file)) continue;

      const deletions = hunk.deleted.filter((d) => containsAssertion(d.content));
      const additions = hunk.added.filter((a) => containsAssertion(a.content));

      // Strict → loose replacement (same chunk, regardless of order).
      for (const del of deletions) {
        if (!isStrictAssertion(del.content)) continue;
        const sibling = additions.find((a) => isLooseAssertion(a.content));
        if (sibling !== undefined) {
          findings.push({
            category: 'test-relaxation',
            severity: 'block',
            message:
              'Existing strict assertion was replaced with a looser matcher. ' +
              'The test no longer covers the original constraint.',
            location: { file: hunk.file, line: sibling.lineNumber },
            evidence: `- ${del.content.trim()}\n+ ${sibling.content.trim()}`,
          });
        }
      }

      // Removed describe/it/test blocks without replacement.
      for (const del of hunk.deleted) {
        if (TEST_BLOCK_OPENERS.some((re) => re.test(del.content))) {
          const replaced = hunk.added.some((a) =>
            TEST_BLOCK_OPENERS.some((re) => re.test(a.content)),
          );
          if (!replaced) {
            findings.push({
              category: 'test-relaxation',
              severity: 'block',
              message:
                'Test block was removed without a replacement in the same hunk. ' +
                'Coverage for the original case is now zero.',
              location: { file: hunk.file, line: del.lineNumber },
              evidence: `- ${del.content.trim()}`,
            });
          }
        }
      }

      // Pure-deletion assertions where the chunk added no compensating
      // assertion. Treated as a relaxation only when the added side has
      // *no* new assertion at all in this chunk — the assertion-strip
      // detector reports the bare strip case separately.
      const pureDeletions = deletions.filter((d) => !isStrictAssertion(d.content));
      if (pureDeletions.length > 0 && additions.length === 0) {
        for (const del of pureDeletions) {
          findings.push({
            category: 'test-relaxation',
            severity: 'warn',
            message:
              'Assertion-bearing line was deleted with no compensating assertion in the same hunk.',
            location: { file: hunk.file, line: del.lineNumber },
            evidence: `- ${del.content.trim()}`,
          });
        }
      }
    }
    return findings;
  },
};

function containsAssertion(line: string): boolean {
  return ASSERTION_LINE.some((re) => re.test(line));
}

function isStrictAssertion(line: string): boolean {
  return STRICT_MATCHERS.some((re) => re.test(line));
}

function isLooseAssertion(line: string): boolean {
  return LOOSE_MATCHERS.some((re) => re.test(line));
}
