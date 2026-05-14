import * as fs from 'fs';
import * as path from 'path';

const TEST_FILE_PATTERN = /(\.|_)(test|spec)\.[a-zA-Z0-9]+$|(^|\/)__tests__\//;

export type TestFramework = 'jest' | 'mocha' | 'vitest' | 'node-test' | 'pytest';

export function isTestFilePath(relPath: string): boolean {
  return TEST_FILE_PATTERN.test(relPath);
}

// Conservative: only obvious cross-framework imports/API references
// trip it. Lookalike frameworks (Jest vs Vitest) are not flagged
// against each other — a false positive (rewrite a valid file) is
// costlier than letting an ambiguous case through.
export function detectTestFrameworkMisuse(
  repoRoot: string,
  relPath: string,
  framework: TestFramework,
): string | null {
  const abs = path.isAbsolute(relPath) ? relPath : path.join(repoRoot, relPath);
  let body: string;
  try {
    body = fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
  const usesJestExpect = /\bexpect\s*\(/.test(body) && /\.\s*to(Be|Equal|StrictEqual|HaveLength|Contain|MatchObject|Throw)/i.test(body);
  const importsNodeTest = /from\s+['"]node:test['"]/.test(body) || /from\s+['"]node:assert/.test(body);
  const importsJestGlobals = /from\s+['"]@jest\/globals['"]/.test(body);
  const importsVitest = /from\s+['"]vitest['"]/.test(body);
  const importsMocha = /from\s+['"]mocha['"]/.test(body);

  const wrong = (msg: string): string =>
    `architect wrote ${relPath} using the wrong test framework for this project (project uses ${framework}). ${msg} Re-emit using the project's framework API.`;

  switch (framework) {
    case 'node-test':
      if (usesJestExpect) return wrong('File uses Jest-style `expect(x).toBe(y)`, which node:test does not support.');
      if (importsJestGlobals) return wrong('File imports from `@jest/globals`.');
      if (importsVitest) return wrong('File imports from `vitest`.');
      if (importsMocha) return wrong('File imports from `mocha`.');
      return null;
    case 'jest':
      if (importsNodeTest) return wrong('File imports from `node:test` / `node:assert`.');
      if (importsVitest) return wrong('File imports from `vitest`.');
      if (importsMocha) return wrong('File imports from `mocha`.');
      return null;
    case 'vitest':
      if (importsNodeTest) return wrong('File imports from `node:test` / `node:assert`.');
      if (importsJestGlobals) return wrong('File imports from `@jest/globals`.');
      if (importsMocha) return wrong('File imports from `mocha`.');
      return null;
    case 'mocha':
      if (usesJestExpect) return wrong('File uses Jest-style `expect(x).toBe(y)`; Mocha + chai uses `expect(x).to.equal(y)`.');
      if (importsNodeTest) return wrong('File imports from `node:test` / `node:assert`.');
      if (importsJestGlobals) return wrong('File imports from `@jest/globals`.');
      if (importsVitest) return wrong('File imports from `vitest`.');
      return null;
    case 'pytest':
      // pytest has no single confusable peer to flag against.
      return null;
  }
}
