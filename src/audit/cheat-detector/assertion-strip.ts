// Assertion-strip: like test-relaxation but specifically for the
// "deleted assertion, added nothing equivalent" case across a *whole
// file*, not just one chunk. If the file's net assertion count went
// down, every removed assertion is reported.

import type { Detector, DetectorContext } from './detector-types';
import type { Finding } from '../types';
import { isTestFile, walkHunks } from './diff-walker';

const VERSION = '1.0.0';

const ASSERTION_PATTERNS: RegExp[] = [
  /\bexpect\s*\(/,
  /\bassert\b/,
  /\bshould\b/,
  /\bt\.Fatal\b/,
  /\bt\.Error\b/,
  /\bt\.Errorf\b/,
  /\bExpect\s*\(/,
];

// An exact-match matcher fully pins its subject's value, so it is at least as
// strong as any looser matcher (toContain, toMatch, toBeTruthy, ...) on the same
// subject. Replacing N looser assertions on a subject with one exact-match
// assertion on that subject re-specifies the value (the test now fails for any
// deviation); it is not a strip. Without this, consolidating two
// `expect(x).toContain(...)` into one `expect(x).toBe(...)` for a deliberate
// behaviour change reads as "net -1 stripped" and gated a real feature PR.
const EXACT_MATCHER = /\.\s*(toBe|toEqual|toStrictEqual|toMatchObject|toMatchInlineSnapshot|toMatchSnapshot)\s*\(/;

export const assertionStripDetector: Detector = {
  name: 'assertion-strip',
  version: VERSION,
  run(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    const perFile = new Map<
      string,
      { added: number; removed: number; removals: Array<{ line: number; content: string; subject: string | null }>; exactAddedSubjects: Set<string> }
    >();
    for (const hunk of walkHunks(ctx.files)) {
      if (!isTestFile(hunk.file)) continue;
      const bucket = perFile.get(hunk.file) ?? { added: 0, removed: 0, removals: [], exactAddedSubjects: new Set<string>() };
      for (const a of hunk.added) {
        if (!isAssertion(a.content)) continue;
        bucket.added += 1;
        if (EXACT_MATCHER.test(a.content)) {
          const subject = assertionSubject(a.content);
          if (subject !== null) bucket.exactAddedSubjects.add(subject);
        }
      }
      for (const d of hunk.deleted) {
        if (isAssertion(d.content)) {
          bucket.removed += 1;
          bucket.removals.push({ line: d.lineNumber, content: d.content, subject: assertionSubject(d.content) });
        }
      }
      perFile.set(hunk.file, bucket);
    }
    for (const [file, stats] of perFile) {
      const net = stats.removed - stats.added;
      if (net <= 0) continue;
      // A removed assertion whose subject gained an added exact-match assertion
      // was re-specified, not stripped; exclude it before reporting.
      const stripped = stats.removals.filter(
        (r) => r.subject === null || !stats.exactAddedSubjects.has(r.subject),
      );
      if (stripped.length === 0) continue;
      for (const removal of stripped.slice(0, net)) {
        findings.push({
          category: 'assertion-strip',
          severity: 'block',
          message:
            `Net assertion count for ${file} dropped by ${net} after this PR. ` +
            `Assertions were removed without equivalents added back.`,
          location: { file, line: removal.line },
          evidence: `- ${removal.content.trim()}`,
        });
      }
    }
    return findings;
  },
};

function isAssertion(line: string): boolean {
  return ASSERTION_PATTERNS.some((re) => re.test(line));
}

/** The subject expression of an `expect(X)` assertion, whitespace-normalized, so
 *  a removed looser assertion and an added exact-match assertion on the same X
 *  can be matched. Returns null for non-expect assertion styles (assert/should),
 *  which then never count as re-specified (fail-closed: they stay strips). */
function assertionSubject(line: string): string | null {
  const m = line.match(/\bexpect\s*\(\s*([\s\S]+?)\s*\)\s*\./i);
  if (m === null || m[1] === undefined) return null;
  return m[1].replace(/\s+/g, ' ').trim();
}
