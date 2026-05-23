// Exception rethrow with lost context: a `throw err` rethrow was
// replaced with a `throw new Error('...')` that does not pass `{ cause }`.
// Loses the underlying stack and breaks downstream error correlation.

import type { Detector, DetectorContext } from './detector-types';
import type { Finding } from '../types';
import { isTestFile, walkHunks } from './diff-walker';

const VERSION = '1.0.0';

const RETHROW_REPLACED_RE = /\bthrow\s+new\s+Error\s*\(/;

export const exceptionRethrowLostContextDetector: Detector = {
  name: 'exception-rethrow-lost-context',
  version: VERSION,
  run(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    for (const hunk of walkHunks(ctx.files)) {
      if (isTestFile(hunk.file)) continue;
      const removedRethrow = hunk.deleted.some((d) => /\bthrow\s+err\b/.test(d.content));
      const addedNewError = hunk.added.find((a) => RETHROW_REPLACED_RE.test(a.content));
      if (!removedRethrow || addedNewError === undefined) continue;
      // If the added new-Error call includes `{ cause:` somewhere in the
      // same chunk, context is preserved.
      const preservesCause = hunk.added.some((a) => /\{\s*cause\s*:/.test(a.content));
      if (preservesCause) continue;
      findings.push({
        category: 'exception-rethrow-lost-context',
        severity: 'block',
        message:
          `Rethrow in ${hunk.file} was replaced with \`throw new Error(...)\` that does not ` +
          `forward the original cause. Stack and chained context will be lost.`,
        location: { file: hunk.file, line: addedNewError.lineNumber },
        evidence: `+ ${addedNewError.content.trim()}`,
      });
    }
    return findings;
  },
};
