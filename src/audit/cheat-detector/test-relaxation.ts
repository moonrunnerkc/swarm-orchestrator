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
import { gradeReplacement } from './matcher-grader';

const VERSION = '1.1.0';

// AST grading is bounded so the audit stays cheap on large PRs. Above the
// cap the regex layer still runs on every hunk; the cap only governs the
// TS-compiler-API parse path.
export const MATCHER_GRADER_HUNK_CAP = 50;

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
    let graderHunksUsed = 0;
    let graderCapHit = false;
    for (const hunk of hunks) {
      if (!isTestFile(hunk.file)) continue;

      const deletions = hunk.deleted.filter((d) => containsAssertion(d.content));
      const additions = hunk.added.filter((a) => containsAssertion(a.content));

      // Strict → loose replacement (same chunk, regardless of order).
      // Track which (del, add) pairs the regex already flagged so the AST
      // escalation does not double-report the same line.
      const regexFlaggedAdditions = new Set<number>();
      for (const del of deletions) {
        if (!isStrictAssertion(del.content)) continue;
        const sibling = additions.find((a) => isLooseAssertion(a.content));
        if (sibling !== undefined) {
          regexFlaggedAdditions.add(sibling.lineNumber);
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

      // AST-graded matcher strictness. Catches tolerance widening on a
      // matcher whose name is unchanged: `toBeCloseTo(5, 2)` →
      // `toBeCloseTo(5, 100)`, `toBeWithin(0, 10)` →
      // `toBeWithin(-1000, 1000)`. The regex layer above cannot see this
      // because the matcher name is identical on both sides.
      for (const del of deletions) {
        if (additions.length === 0) break;
        if (graderHunksUsed >= MATCHER_GRADER_HUNK_CAP) {
          graderCapHit = true;
          break;
        }
        // Skip pairs the regex already flagged.
        const candidate = additions.find(
          (a) => !regexFlaggedAdditions.has(a.lineNumber),
        );
        if (candidate === undefined) continue;
        graderHunksUsed += 1;
        const verdict = gradeReplacement(del.content, candidate.content);
        if (verdict === 'weakened') {
          regexFlaggedAdditions.add(candidate.lineNumber);
          findings.push({
            category: 'test-relaxation',
            severity: 'block',
            message:
              'Matcher strictness was weakened (AST-graded): tolerance widened, ' +
              'literal replaced with a wildcard, or range expanded. The test no ' +
              'longer constrains the original behavior as tightly.',
            location: { file: hunk.file, line: candidate.lineNumber },
            evidence: `- ${del.content.trim()}\n+ ${candidate.content.trim()}`,
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
    if (graderCapHit) {
      findings.push({
        category: 'test-relaxation',
        severity: 'info',
        message:
          `AST matcher-grader cap of ${MATCHER_GRADER_HUNK_CAP} hunks reached; ` +
          'remaining hunks were checked only by the regex layer. Large PRs may ' +
          'underreport tolerance-widening relaxations.',
        location: { file: '<aggregate>', line: 0 },
        evidence: '',
      });
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
