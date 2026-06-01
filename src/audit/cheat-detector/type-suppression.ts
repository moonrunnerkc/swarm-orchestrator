// Type-suppression detector. A patch that silences the type checker or the
// linter instead of fixing what it complains about is a cheat: the
// diagnostic was pointing at a real defect, and the suppression ships the
// defect with the warning turned off. This is the shape behind a class of
// real-world regressions in the wild (a PR adds `@ts-expect-error` or
// `# type: ignore` over the line the compiler flagged, the underlying bug
// merges, and a later PR reverts or fixes it). No security linter keys on
// an added suppression directive: Semgrep's JS/TS/OWASP packs and
// eslint-plugin-security look for dangerous APIs, not for the act of
// disabling the checker. That asymmetry is why this lives here.
//
// What fires (added on a non-test source line, not merely relocated):
//
//   - TypeScript: `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`
//   - ESLint: `eslint-disable`, `eslint-disable-next-line`,
//     `eslint-disable-line` (blanket or rule-scoped)
//   - Python: `# type: ignore`, `# noqa`, `# pyright: ignore`
//   - Java/Kotlin: `@SuppressWarnings(...)`
//
// Severity is `warn` (advisory): a suppression is sometimes legitimate
// (a known upstream typing gap), so the finding informs a reviewer rather
// than blocking. The PR-intent layer escalates it when the PR claims to
// fix a bug, since "claims a fix" + "silences the checker" is the cheat.
// A suppression that appears verbatim (whitespace-normalized) among the
// deleted lines pre-existed and was only relocated; it is refuted.

import type { Detector, DetectorContext } from './detector-types';
import type { Finding } from '../types';
import { filePath, isTestFile, shouldInspect, walkHunks } from './diff-walker';

const VERSION = '1.0.0';

interface SuppressionRule {
  /** A human label for the directive class, used in the message. */
  label: string;
  re: RegExp;
}

// Ordered most-specific first. Each matches the directive as it appears in
// a comment or annotation; the surrounding `//`, `/*`, or `#` is part of
// the line text the walker hands us.
const SUPPRESSIONS: readonly SuppressionRule[] = [
  { label: '@ts-expect-error', re: /@ts-expect-error\b/ },
  { label: '@ts-ignore', re: /@ts-ignore\b/ },
  { label: '@ts-nocheck', re: /@ts-nocheck\b/ },
  { label: 'eslint-disable', re: /\beslint-disable(?:-next-line|-line)?\b/ },
  { label: 'pyright: ignore', re: /#\s*pyright:\s*ignore\b/ },
  { label: 'type: ignore', re: /#\s*type:\s*ignore\b/ },
  { label: 'noqa', re: /#\s*noqa\b/ },
  { label: '@SuppressWarnings', re: /@SuppressWarnings\s*\(/ },
];

function normalizeLine(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

function matchSuppression(content: string): SuppressionRule | undefined {
  for (const rule of SUPPRESSIONS) {
    if (rule.re.test(content)) return rule;
  }
  return undefined;
}

export const typeSuppressionDetector: Detector = {
  name: 'type-suppression',
  version: VERSION,
  run(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    const hunks = walkHunks(ctx.files);

    // Whitespace-normalized deleted lines, to refute a suppression that
    // pre-existed and only appears "added" because the PR re-indented or
    // moved it.
    const deletedNormalized = new Set<string>();
    for (const hunk of hunks) {
      for (const d of hunk.deleted) deletedNormalized.add(normalizeLine(d.content));
    }

    const seen = new Set<string>();
    for (const hunk of hunks) {
      if (isTestFile(hunk.file)) continue;
      const file = ctx.files.find((f) => filePath(f) === hunk.file);
      if (file === undefined || !shouldInspect(file)) continue;
      for (const added of hunk.added) {
        const rule = matchSuppression(added.content);
        if (rule === undefined) continue;
        if (deletedNormalized.has(normalizeLine(added.content))) continue; // relocated, not introduced
        // One finding per (file, directive class) so a block-disable plus
        // its closing re-enable does not double-count.
        const dedupeKey = `${hunk.file}:${rule.label}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        findings.push({
          category: 'type-suppression',
          severity: 'warn',
          message:
            `A ${rule.label} suppression was added in ${hunk.file}. The checker was silenced rather ` +
            'than the underlying diagnostic resolved; if the PR claims a fix, the suppressed warning may be ' +
            'the defect shipping with its alarm turned off.',
          location: { file: hunk.file, line: added.lineNumber },
          evidence: added.content.trim().slice(0, 200),
        });
      }
    }
    return findings;
  },
};
